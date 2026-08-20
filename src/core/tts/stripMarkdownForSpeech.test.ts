import { describe, expect, it } from 'vitest'
import { stripMarkdownForSpeech } from './stripMarkdownForSpeech'

// The voice never speaks markdown (#52): whatever the model leaks into the
// speak field — emphasis markers, code fences, link URLs — must arrive at
// the synthesizer as plain prose. These tests pin the spoken text only.

describe('stripMarkdownForSpeech', () => {
  describe('emphasis markers', () => {
    it('unwraps bold and italic asterisk pairs', () => {
      expect(stripMarkdownForSpeech('The **best** video is *this* one')).toBe(
        'The best video is this one',
      )
    })

    it('unwraps underscore emphasis without eating snake_case words', () => {
      expect(stripMarkdownForSpeech('A _really_ good __find__')).toBe('A really good find')
      expect(stripMarkdownForSpeech('Ran npm_install_test cleanly')).toBe(
        'Ran npm_install_test cleanly',
      )
    })

    it('drops stray unpaired asterisks the model leaked', () => {
      expect(stripMarkdownForSpeech('*asterisk asterisk* everywhere *')).toBe(
        'asterisk asterisk everywhere',
      )
    })
  })

  describe('code', () => {
    it('strips inline code backticks but keeps the code words', () => {
      expect(stripMarkdownForSpeech('Install it with `npm i piper` first')).toBe(
        'Install it with npm i piper first',
      )
    })

    it('strips code fence markers and the language tag, keeping the code text', () => {
      const spoken = stripMarkdownForSpeech('Do this:\n```bash\nnpm install\n```\nDone.')
      expect(spoken).toBe('Do this:\nnpm install\nDone.')
    })
  })

  describe('links', () => {
    it('speaks the label and never the URL of a markdown link', () => {
      const spoken = stripMarkdownForSpeech('See [the guide](https://example.com/a?b=1) now')
      expect(spoken).toBe('See the guide now')
    })

    it('consumes parenthesised URLs whole instead of leaving bracket debris', () => {
      const spoken = stripMarkdownForSpeech('See [Foo](https://en.wikipedia.org/wiki/Foo_(bar)) now')
      expect(spoken).toBe('See Foo now')
    })

    it('drops link titles and empty-label links entirely', () => {
      expect(stripMarkdownForSpeech('Open [docs](https://docs.site/x "Docs home")')).toBe(
        'Open docs',
      )
      expect(stripMarkdownForSpeech('Go to [](https://example.com) now')).toBe('Go to now')
    })

    it('speaks image alt text instead of the image URL', () => {
      expect(stripMarkdownForSpeech('Chart: ![sales chart](https://img.example.com/x.png)')).toBe(
        'Chart: sales chart',
      )
    })
  })

  describe('headings and lists', () => {
    it('drops heading markers so titles read as plain sentences', () => {
      expect(stripMarkdownForSpeech('## Summary')).toBe('Summary')
      expect(stripMarkdownForSpeech('###Deep dive')).toBe('Deep dive')
    })

    it('drops unordered list bullets and blockquote markers', () => {
      expect(stripMarkdownForSpeech('- first\n* second\n+ third')).toBe('first\nsecond\nthird')
      expect(stripMarkdownForSpeech('> quoted line')).toBe('quoted line')
    })

    it('drops thematic break lines', () => {
      expect(stripMarkdownForSpeech('Part one\n---\nPart two')).toBe('Part one\nPart two')
    })
  })

  describe('a realistic leaked answer', () => {
    it('cleans a markdown-heavy speak field into natural prose', () => {
      const leaked =
        '# Result\nI opened **YouTube** and played *Linus Tech Tips* — see [the video](https://youtu.be/abc).\n- It is playing\n```json\n{"ok":true}\n```'
      expect(stripMarkdownForSpeech(leaked)).toBe(
        'Result\nI opened YouTube and played Linus Tech Tips — see the video.\nIt is playing\n{"ok":true}',
      )
    })

    it('leaves plain speech untouched', () => {
      expect(stripMarkdownForSpeech('Done. The video is playing now.')).toBe(
        'Done. The video is playing now.',
      )
    })

    it('collapses marker debris into tidy spacing', () => {
      expect(stripMarkdownForSpeech('Done.   \n\n\n  Playing.  ')).toBe('Done.\n\nPlaying.')
    })
  })
})
