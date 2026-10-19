/**
 * Words with a hyphen inside ("Weigh-in") kept whole: never broken at the
 * hyphen across two lines, and set without tabular figures, whose wide
 * hyphen read "Weigh - in" on a line in tabular-nums.
 */
export function NoBreakHyphens({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\S+-\S+)/).map((part, index) =>
        index % 2 === 1 ? (
          <span key={index} className="no-break">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  )
}
