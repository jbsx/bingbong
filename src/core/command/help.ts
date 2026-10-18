// The one help text (#324): what a line can say, spoken or typed. The
// runner shows it for the `help` verb and the CLI harness prints it for its
// own `help`, adding the lines that are the harness's alone.

export const COMMAND_HELP_LINES: readonly string[] = [
  'a line is one command — plain words or the grammar:',
  '  open <site or words>     a bare word opens its .com, a url is opened, other words are searched',
  '  search for <words>       search the words',
  '  click <label or ref>     click the element the label names, or ref <n> from the last read',
  '  type <text> in <field>   type into the field the label names (or: type <ref> <text>)',
  '  scroll up|down           scroll the page',
  '  back | forward           move in history',
  '  reload                   load the page again',
  '  press enter|escape|space|up|down|left|right [n]',
  '  read                     print a numbered-ref snapshot of visible interactive elements',
  '  clear                    clear the focused field',
  '  screenshot [path]        save a jpeg screenshot (default: the downloads dir)',
  '  stop                     interrupt the command in flight',
  '  help                     this text',
]

export const COMMAND_HELP = COMMAND_HELP_LINES.join('\n')
