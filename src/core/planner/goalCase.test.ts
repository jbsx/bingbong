import { describe, expect, it } from 'vitest'
import { formatGoalGate, goalJudgeMessages, readGoalCase, readGoalVerdict, type GoalRun } from './goalCase'

const run: GoalRun = {
  transcript: 'Open the comments and read me the top one.',
  meant: 'the first comment’s text spoken aloud',
  start: 'a YouTube watch page',
  url: 'https://www.youtube.com/watch?v=x',
  title: 'A video - YouTube',
  textInView: 'Comments 1,204 @someone 2 days ago Nice video',
  said: ['The top comment says: Nice video.'],
  asked: [],
  declined: false,
  shelf: [],
  clipboard: null,
  ended: 'done',
  seconds: 6.4,
  timedOut: false,
}

describe('readGoalCase (#465)', () => {
  it('reads a case file and refuses one missing a field', () => {
    const raw = { id: 'goal-04', transcript: 't', start: 's', meant: 'm', source: 'owner' }
    expect(readGoalCase(raw)).toEqual(raw)
    expect(readGoalCase({ ...raw, meant: '' })).toBe('meant is missing')
    expect(readGoalCase('x')).toBe('not an object')
  })
})

describe('the goal gate’s judge (#465): told what was meant and what came of it', () => {
  it('puts the Goal Line and the meant outcome each on a labelled line, then everything the run left', () => {
    const { system, user } = goalJudgeMessages({ ...run, asked: ['Post this comment?'], declined: true, shelf: ['thumb.jpg'], clipboard: 'npm init playwright@latest' })
    expect(system).toMatch(/exactly one JSON object/)
    expect(system).toMatch(/declines every confirm/)
    expect(system).toMatch(/a cookie or consent wall is no such wall/)
    expect(user.split('\n')).toEqual([
      'Goal Line: Open the comments and read me the top one.',
      'Meant: the first comment’s text spoken aloud',
      'Started on: a YouTube watch page',
      'Final page: https://www.youtube.com/watch?v=x — "A video - YouTube"',
      'The Task ended: done, after 6.4 s',
      'Said aloud: "The top comment says: Nice video."',
      'Confirms put to the user: "Post this comment?" — declined by the gate, as it declines every confirm',
      'On the Shelf: thumb.jpg',
      'On the clipboard: "npm init playwright@latest"',
      'Text in view on the final page:',
      'Comments 1,204 @someone 2 days ago Nice video',
    ])
  })

  it('says so when nothing was said, asked, shelved or copied, and when the run passed the 90 s bound', () => {
    const { user } = goalJudgeMessages({ ...run, said: [], ended: null, timedOut: true, seconds: 90, textInView: '' })
    expect(user).toContain('The Task ended: still running at the 90 s bound')
    expect(user).toContain('Said aloud: nothing')
    expect(user).toContain('Confirms put to the user: nothing')
    expect(user).toContain('On the Shelf: nothing')
    expect(user).toContain('On the clipboard: nothing')
    expect(user).toContain('Text in view on the final page:\n(none)')
  })

  it.each([
    ['{"verdict":"done","why":"the comment was read aloud"}', { verdict: 'done', why: 'the comment was read aloud' }],
    ['```json\n{"verdict":"wall","why":"sign in to like"}\n```', { verdict: 'wall', why: 'sign in to like' }],
    ['{"verdict":"miss"}', { verdict: 'miss', why: '' }],
  ])('reads %j', (content, expected) => {
    expect(readGoalVerdict(content)).toEqual(expected)
  })

  it.each(['yes', '{"verdict":"maybe","why":"x"}'])('reads no verdict from %j', (content) => {
    expect(readGoalVerdict(content)).toBeNull()
  })
})

describe('formatGoalGate (#465): one row per case, the judge’s id in the header', () => {
  it('prints done-right, seconds, how the Task ended and the judge’s line, then the tally', () => {
    expect(
      formatGoalGate(
        [
          { id: 'goal-01-comment', runs: [{ verdict: 'miss', why: 'no comment box opened', seconds: 8.24, ended: 'unsure' }] },
          { id: 'goal-04-read', runs: [{ verdict: 'done', why: 'read aloud', seconds: 6.4, ended: 'done' }] },
          { id: 'goal-03-like', runs: [{ verdict: 'wall', why: 'sign-in wall', seconds: 4, ended: 'wall' }] },
          { id: 'goal-08-weather', runs: [{ verdict: null, why: 'judge unavailable: timeout', seconds: 12, ended: 'cap' }] },
          { id: 'goal-09-mkbhd', runs: [{ verdict: null, why: 'run failed: the CLI harness never prompted', seconds: null, ended: null }] },
        ],
        { arm: 'Task loop', judge: 'glm-5.3-flash' },
      ),
    ).toBe(
      [
        'goal:gate — Task loop, judge glm-5.3-flash, 5 cases × 1',
        'case             right  seconds  ended   judge',
        'goal-01-comment  no        8.2s  unsure  no comment box opened',
        'goal-04-read     yes       6.4s  done    read aloud',
        'goal-03-like     wall      4.0s  wall    sign-in wall',
        'goal-08-weather  ?        12.0s  cap     judge unavailable: timeout',
        'goal-09-mkbhd    ?            —  —       run failed: the CLI harness never prompted',
        'done-right 1/5, walls 1, unjudged 2 | seconds p50 6.4s p95 12.0s over 4 runs',
      ].join('\n'),
    )
  })

  it('with --repeat, counts done-right across the runs and takes the seconds p50; a run the judge could not read is a miss with its reason', () => {
    expect(
      formatGoalGate(
        [
          {
            id: 'goal-04-read',
            runs: [
              { verdict: 'done', why: 'read aloud', seconds: 6, ended: 'done' },
              { verdict: 'miss', why: 'read the description', seconds: 9, ended: 'done' },
              { verdict: 'done', why: 'read aloud', seconds: 7, ended: 'done' },
            ],
          },
          { id: 'goal-08-weather', runs: [{ verdict: null, why: 'judge unavailable: timeout', seconds: 12, ended: 'cap' }, { verdict: 'miss', why: 'one city', seconds: 10, ended: 'cap' }, { verdict: 'miss', why: 'one city', seconds: 11, ended: 'cap' }] },
        ],
        { arm: 'Task loop', judge: 'glm-5.3-flash' },
      ),
    ).toBe(
      [
        'goal:gate — Task loop, judge glm-5.3-flash, 2 cases × 3',
        'case             right  seconds  ended  judge',
        'goal-04-read     2/3       7.0s  done   read aloud',
        'goal-08-weather  0/3      11.0s  cap    one city (1 unjudged)',
        'done-right 2/6, walls 0, unjudged 1 | seconds p50 9.0s p95 12.0s over 6 runs',
      ].join('\n'),
    )
  })
})
