import { Btn, CFoot, CHead, CMain, Chip, Line, Panel, Rows, SecHead } from './brand/anatomy';
import { ChevronIcon } from './brand/icons';
import type { SetupTask } from '@/lib/clearModel';

/**
 * Home's temporary slot, in use: the setup steps still outstanding, one row each with its button.
 *
 * **Absent when empty, never present and empty.** With nothing outstanding Home drops from three
 * blocks to two.
 */
export default function TaskStrip({
  tasks,
  onAction,
  limit,
}: {
  tasks: SetupTask[];
  onAction?: (id: string) => void;
  /** How many rows to show. The phone shows the first only. */
  limit?: number;
}) {
  const open = tasks.filter((t) => !t.done).slice(0, limit);
  if (open.length === 0) return null;

  return (
    <Panel>
      <CMain>
        <Rows>
          {open.map((task) => (
            <div key={task.id}>
              <Line className="items-center!">
                <span className="text-sec">{task.label}</span>
                {task.cta && <Btn onClick={() => onAction?.(task.id)}>{task.cta}</Btn>}
              </Line>
            </div>
          ))}
        </Rows>
      </CMain>
    </Panel>
  );
}

/**
 * Getting set up — the temporary slot on day one.
 *
 * Every step in order. Done steps carry a settled chip; the first open step is the one current thing
 * on the screen, so it takes the cobalt and a pinging chip — the only thing on day one that pulses.
 * Later steps are muted with a chevron. The footer is the action that moves the member forward.
 */
export function SetupPanel({
  tasks,
  onAction,
  onAddMoney,
}: {
  tasks: SetupTask[];
  onAction?: (id: string) => void;
  onAddMoney?: () => void;
}) {
  const done = tasks.filter((t) => t.done).length;
  const current = tasks.find((t) => !t.done);

  return (
    <Panel act>
      <CHead>
        <SecHead label="Getting set up">
          <span className="c-det">
            {done} of {tasks.length}
          </span>
        </SecHead>
      </CHead>
      <CMain>
        <Rows>
          {tasks.map((task) => (
            <div key={task.id}>
              {task.done ? (
                <Line className="items-center!">
                  <span className="text-sec">{task.label}</span>
                  <Chip tone="settled" core>
                    Done
                  </Chip>
                </Line>
              ) : task === current ? (
                <Line className="items-center!">
                  <span className="text-sec font-medium text-live">{task.label}</span>
                  <Chip tone="live" ping>
                    Now
                  </Chip>
                </Line>
              ) : (
                <button type="button" className="c-line w-full items-center! text-left" onClick={() => onAction?.(task.id)}>
                  <span className="c-muted text-sec">{task.label}</span>
                  <ChevronIcon size={14} strokeWidth={2.2} className="shrink-0 text-ink-50" />
                </button>
              )}
            </div>
          ))}
        </Rows>
      </CMain>
      <CFoot>
        <Btn primary lg onClick={onAddMoney}>
          Add money
        </Btn>
      </CFoot>
    </Panel>
  );
}
