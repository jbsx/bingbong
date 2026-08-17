#!/usr/bin/env python3
"""Bing Bong wake-word sidecar (T10 fallback engine).

Runs the reference openwakeword implementation behind a tiny framed protocol
so the Node app can swap engines config-only (BINGBONG_WAKE_ENGINE=python).
Requires: pip install openwakeword onnxruntime

Protocol (both directions): 4-byte LE length (type byte + payload), 1 type
byte, payload.
  Node -> Python: 0 = audio (s16le 16 kHz mono PCM), 1 = reset
  Python -> Node: 0 = score (ASCII float), 1 = error (ASCII message)

One score frame is emitted per 1280-sample (80 ms) audio chunk, matching the
Node ONNX port's chunk cadence. VAD gating stays on the Node side so both
engines share identical false-positive suppression.
"""

import argparse
import struct
import sys

MSG_AUDIO = 0
MSG_RESET = 1
MSG_SCORE = 0
MSG_ERROR = 1

CHUNK_BYTES = 1280 * 2  # 80 ms of s16le at 16 kHz


def read_exact(stream, count):
    data = b""
    while len(data) < count:
        part = stream.read(count - len(data))
        if not part:
            return None
        data += part
    return data


def send(stream, msg_type, payload):
    stream.write(struct.pack("<IB", 1 + len(payload), msg_type) + payload)
    stream.flush()


def fail(stream, message):
    try:
        send(stream, MSG_ERROR, message.encode("utf-8", "replace"))
    except Exception:
        pass
    sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True, help="Path to the wake-word classifier .onnx")
    parser.add_argument("--framework", default="onnx", choices=["onnx", "tflite"])
    args = parser.parse_args()

    stdin = sys.stdin.buffer
    stdout = sys.stdout.buffer

    try:
        from openwakeword.model import Model

        model = Model(wakeword_models=[args.model], inference_framework=args.framework)
    except Exception as err:  # missing package, missing model file, …
        fail(stdout, f"wake sidecar failed to start: {err}")

    pending = bytearray()
    while True:
        header = read_exact(stdin, 5)
        if header is None:  # parent closed stdin — shut down quietly
            return
        length, msg_type = struct.unpack("<IB", header)
        payload = read_exact(stdin, length - 1)
        if payload is None:
            return

        if msg_type == MSG_RESET:
            model.reset()
            continue

        pending.extend(payload)
        while len(pending) >= CHUNK_BYTES:
            chunk = bytes(pending[:CHUNK_BYTES])
            del pending[:CHUNK_BYTES]
            try:
                import numpy as np

                scores = model.predict(np.frombuffer(chunk, dtype=np.int16))
                score = max(scores.values()) if scores else 0.0
            except Exception as err:
                fail(stdout, f"wake sidecar prediction failed: {err}")
            send(stdout, MSG_SCORE, f"{score:.6f}".encode("ascii"))


if __name__ == "__main__":
    main()
