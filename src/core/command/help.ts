// The one help text (#324): what a line can say, spoken or typed. The
// runner shows it for the `help` verb and the CLI harness prints it for its
// own `help`, adding the lines that are the harness's alone.

export const COMMAND_HELP_LINES: readonly string[] = [
  'a line is one command — plain words or the grammar:',
  '  (a line that takes no words — back, reload, read, clear, stop, resume — is the whole line: “stop it” is plain words)',
  '  open <site or words>     a bare word opens its .com, a url is opened; other words are read against the page, its site and the web',
  '  click <label or ref>     click the element the label names, or ref <n> from the last read',
  '  menu <ref>               open the element’s right-click menu (or: right-click <label>)',
  '  type <text> in <field>   type into the field the label names (or: type <ref> <text>)',
  '  scroll up|down           scroll the page',
  '  back | forward           move in history',
  '  reload                   load the page again',
  '  resume                   return to the last page — after a restart, it is reopened',
  '  timer <length> | off     count down on the idle screen and ring (5m, 1h30m, 2:30, ten minutes)',
  '  play <words> [next]      play the first youtube video for the words now (or next in the queue)',
  '  queue <words>            add the first youtube video for the words to the queue',
  '  not that one             play the next result of the last search instead (or: the one before)',
  '  forget this song         the next play of its words searches again',
  '  play | pause             unpause and pause the music',
  '  skip | previous          the next queued song, or the one before',
  '  loop | loop off          repeat this song, or stop repeating it',
  '  restart                  play this song from the beginning',
  '  louder | quieter | volume <0-100> | mute | unmute',
  '  press enter|escape|tab|space|up|down|left|right [n]   (or: press down three times)',
  '  read                     print a numbered-ref snapshot of visible interactive elements',
  '  clear                    clear the focused field',
  '  screenshot [path]        save a jpeg screenshot (default: the downloads dir)',
  '  stop                     interrupt the command in flight — with none, pause the music',
  '  mark this as a failure [with the hint <words>]   keep the last task for later (or: flag that, that was wrong)',
  '  help                     this text',
]

export const COMMAND_HELP = COMMAND_HELP_LINES.join('\n')
