// @ts-nocheck: generated from the prototype's templates (see docs/command-reference/DECISIONS.md). Typed when Phase 3 puts API rows behind it.
import { LIVE } from '../live/env';
import * as live from '../live/account';
import { css } from '../runtime/dom';
import { D, laneFrame, pctX } from './contracts';
import { head, ic } from './core';
import { AREAS, CAN, DAY, DEMO_PEOPLE, INVITES, LOG, LV, PEOPLE_T, RESULT, ROLES, RULES2, SECS, SIGNIN, TS, WAIT2, WEEK, vars } from './data';
import { kv, sec, vModal } from './governance';
import { G, columns, figHtml, figSide, fmtD, gCell } from './growth';
import { mkey } from './home';
import { mCount } from './members';
import { strip } from './money';
import { H2, apprMatrix, areaDot } from './records';
import { closeModal, viewAs } from './shell';
export function accOf(p) {
  return p.off ? SECS.map(() => 0) : p.custom || ROLES[p.role][2];
}
export function grpName(p) {
  return p.off ? 'Off' : p.custom ? 'Custom' : ROLES[p.role][0];
}
export function MEMBERS_N() {
  return mCount((m) => m.status === 'active' || m.status === 'opened');
}
export function pOf(id) {
  return PEOPLE_T.find((p) => p.id === id) ?? (LIVE ? DEMO_PEOPLE.find((p) => p.id === id) : undefined);
}
export function lvSq(v, big) {
  return <i className={`lv lv${v}${big ? ' big' : ''}`} title={LV[v]} />;
}
export function lvKey() {
  return (
    <div className="mkey">
      {LV.map((t, i) => (
        <span key={i}>
          {lvSq(i)}
          {t}
        </span>
      ))}
    </div>
  );
}
export function avatar(id, n, cls = '') {
  return (
    <i className={`sg-sq${id === (LIVE ? vars.meId : 'K') ? ' me' : ''} ${cls}`} title={n || ''}>
      {id}
    </i>
  );
}
export function actsOf(id) {
  const days = Array.from(
    {
      length: 7,
    },
    (_, d) => H2(10, 15 + d, 0),
  );
  return days.map(
    (t) => WEEK.filter((e) => e[1] === id && e[0] >= t && e[0] < t + DAY).length + LOG.filter((l) => l[2] === id && l[1] >= t && l[1] < t + DAY).length,
  );
}
export function accessMap() {
  const head = (
    <div className="ax-r ax-h">
      <span />
      {SECS.map(([k, t], __k) => (
        <span key={__k}>{t}</span>
      ))}
    </div>
  );
  const rows = PEOPLE_T.map((p, __k) => {
    const r = ROLES[p.role];
    return (
      <button key={__k} type="button" className={`ax-r${p.off ? ' off' : ''}`} data-person={p.id}>
        <span className="ax-k">
          {avatar(p.id, p.n)}
          <span>
            <b>{p.n}</b>
            <span>{p.off ? 'Access turned off' : p.custom ? `Custom · from ${r[0]}` : r[0]}</span>
          </span>
        </span>
        {accOf(p).map((v, __k) => (
          <span key={__k} className="ax-c">
            {lvSq(v)}
          </span>
        ))}
      </button>
    );
  });
  const mem = (
    <button type="button" className="ax-r ax-m" data-tflow="role" data-tid="members">
      <span className="ax-k">
        <i className="sg-sq grp" title="Members">
          {MEMBERS_N()}
        </i>
        <span>
          <b>Every member</b>
          <span>Read-only</span>
        </span>
      </span>
      {ROLES.members[2].map((v, __k) => (
        <span key={__k} className="ax-c">
          {lvSq(v)}
        </span>
      ))}
    </button>
  );
  const inv = INVITES.map(([id, n, role, s], __k) => (
    <div key={__k} className="ax-r inv">
      <span className="ax-k">
        {avatar(id, n, 'dash')}
        <span>
          <b>{n}</b>
          <span>
            {'Invited · '}
            {ROLES[role][0]}
          </span>
        </span>
      </span>
      {ROLES[role][2].map((v, __k) => (
        <span key={__k} className="ax-c">
          {lvSq(v)}
        </span>
      ))}
    </div>
  ));
  return (
    <div className="ax">
      {head}
      {mem}
      {rows}
      {inv}
    </div>
  );
}
export function coverage() {
  return (
    <>
      <div className="cvg">
        {CAN.map(([c, ids], __k) => (
          <div key={__k} className={`cvg-r${ids.length < 2 ? ' one' : ''}`}>
            <span className="cvg-k">{c}</span>
            <span className="cvg-a">
              {ids.map((id) => avatar(id, pOf(id).n))}
              {Array.from(
                {
                  length: 3 - ids.length,
                },
                (_, __k) => (
                  <i key={__k} className="sg-sq empty" />
                ),
              )}
            </span>
          </div>
        ))}
      </div>
      {mkey([['var(--underway)', 'Only one person can do it']])}
    </>
  );
}
export function actCols() {
  return (
    <div className="ac">
      {PEOPLE_T.filter((p) => ['K', 'DR', 'ML'].includes(p.id))
        .concat([
          {
            id: 'SY',
            n: 'System',
          },
        ])
        .map((p, __k) => {
          const v = actsOf(p.id),
            m = 10;
          return (
            <div key={__k} className="ac-r">
              <span className="ac-k">
                <b>{p.n}</b>
                <span>
                  {v.reduce((a, b) => a + b, 0)}
                  {' this week'}
                </span>
              </span>
              <span className="ac-b">
                {v.map((x, i) => (
                  <i key={i} style={css(`height:${Math.max(2, (x / m) * 100)}%`)} className={i === 6 ? 'now' : ''} title={x} />
                ))}
              </span>
            </div>
          );
        })}
      <div className="ac-r ac-x">
        <span />
        <span className="ac-b ax-days">
          {['Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Today'].map((d, __k) => (
            <span key={__k}>{d}</span>
          ))}
        </span>
      </div>
    </div>
  );
}

/* ── page ─────────────────────────────────────────────────────────────── */
export function teamPage() {
  const P = TS.pane,
    ones = CAN.filter((c) => c[1].length < 2).length;
  const title =
    P === 'overview'
      ? `${['', 'One thing', 'Two things', 'Three things', 'Four things'][ones]} only one person can do.`
      : P === 'people'
        ? `${['', 'One person has', 'Two people have', 'Three people have', 'Four people have', 'Five people have', 'Six people have'][PEOPLE_T.filter((p) => !p.off).length]} access.`
        : P === 'roles'
          ? `${vars.TEAMG.length} groups, and every member.`
          : `${['Nothing is', 'One action is', 'Two actions are', 'Three actions are', 'Four actions are'][WAIT2.length]} waiting on a second person.`;
  const tools = (
    <button className="btn btn-p" type="button" data-tflow="invite">
      <span className="dot pulse" style={css('color:var(--btn-dot)')} aria-hidden="true" />
      Invite someone
    </button>
  );
  const tabs = [
    ['overview', 'Overview'],
    ['roles', 'Groups'],
    ['people', 'People'],
    ['rule', 'Two-person rule'],
  ];
  const body = {
    overview: tOverview,
    people: tPeople,
    roles: tRoles,
    rule: tRule,
  }[P]();
  return (
    <>
      {head(
        <>
          {'Permissions · '}
          <b>One login for the app and here</b>
        </>,
        title,
        tools,
      )}
      <nav className="ptabs" aria-label="Permissions panes">
        {tabs.map(([v, t], __k) => (
          <button key={__k} type="button" data-tpane={v} aria-current={P === v ? 'page' : 'false'}>
            {t}
          </button>
        ))}
      </nav>
      {body}
      {teamPane()}
    </>
  );
}
export function accessCell(span) {
  return (
    <section className={`cell ${span}`}>
      <header className="c-hd">
        <span className="lbl">Who can do what</span>
        <span className="tag">Select a person or group</span>
      </header>
      <div className="c-fig">
        {figSide(String(PEOPLE_T.filter((p) => !p.off).length), 'on the team', `plus ${MEMBERS_N()} members with the read-only view`)}
      </div>
      <div className="c-body start">
        {accessMap()}
        {lvKey()}
      </div>
      {strip([
        ['Admins', String(PEOPLE_T.filter((p) => p.role === 'admin').length)],
        ['Safe signers', String(PEOPLE_T.filter((p) => p.signer).length)],
        ['Without a passkey', String(PEOPLE_T.filter((p) => !p.passkey).length), '', 'warn'],
        ['Keys in this app', 'None'],
      ])}
    </section>
  );
}
export function waitCell(span, onRule) {
  return (
    <section className={`cell ${span}`}>
      <header className="c-hd">
        <span className="lbl">Waiting on a second person</span>
        <span className="tag">
          {WAIT2.length}
          {' now'}
        </span>
      </header>
      <div className="c-fig">{figHtml('30 h', 'the longest wait · AssurancePool v1.3 is waiting on you')}</div>
      <div className="c-body start">
        <div className="pn-list">
          {WAIT2.map(([t, s, w, age, a], __k) => (
            <button key={__k} type="button" className="pn-r wt2" data-go={a === 'money' ? 'money' : a === 'shop' ? 'shop' : 'contracts'}>
              <i className="dt-ic" style={css(areaDot(a))} />
              <span className="pn-k">
                <b>{t}</b>
                <span className="small quiet">{s}</span>
              </span>
              <span className="wt2-w">
                <span className="small quiet">Waiting on</span>
                <b className={w === 'Kai' ? 'me' : ''}>{w === 'Kai' ? 'You' : w}</b>
              </span>
              <span className="mono quiet small">{age}</span>
            </button>
          ))}
        </div>
        <div className="ablock">
          <span className="lbl">Hours waiting · tick is the usual wait</span>
          {WAIT2.map(([t, , , , a, h, med], __k) => (
            <div key={__k} className="wb-r">
              <span className="wb-k">{t.split(' · ')[0]}</span>
              <span className="wb-b">
                <i style={css(`width:${(h / 36) * 100}%;${h > med * 3 ? 'background:var(--underway)' : ''}`)} />
                <em style={css(`left:${(med / 36) * 100}%`)} />
              </span>
              <b className="num">
                {h}
                {' h'}
              </b>
            </div>
          ))}
          <div className="wb-ax">
            <span />
            <span className="wb-axl">
              <span>0</span>
              <span>12 h</span>
              <span>24 h</span>
              <span>36 h</span>
            </span>
            <span />
          </div>
        </div>
      </div>
      {onRule ? (
        strip([
          ['Waiting', String(WAIT2.length)],
          ['Longest', '30 h', '', 'warn'],
          ['Usual', '2–8 h'],
        ])
      ) : (
        <div className="c-ft">
          <button type="button" data-tpane="rule">
            <span className="t">The two-person rule</span>
            {ic('chev', 'sm')}
          </button>
        </div>
      )}
    </section>
  );
}
export function tOverview() {
  const ones = CAN.filter((c) => c[1].length < 2).length;
  const cov = gCell(
    's-4 wt',
    'If someone is out',
    'Who can do each thing',
    figHtml(String(ones), 'things only one person can do · worth a backup'),
    coverage(),
    strip([
      ['Single points', String(ones), '', 'warn'],
      ['Covered by 2+', String(CAN.length - ones)],
    ]),
  );
  const act = gCell(
    's-6',
    'Activity',
    'Actions a day, this week',
    figHtml('Marcus Lee', 'the busiest this week · mostly on the poster route'),
    actCols(),
    <div className="c-ft">
      <button type="button" data-rpane="log">
        <span className="t">The audit log</span>
        {ic('chev', 'sm')}
      </button>
    </div>,
  );
  return (
    <>
      {G(
        'Access',
        'Every action is logged with who did it',
        '',
        <>
          {accessCell('s-8')}
          {cov}
        </>,
      )}
      {G(
        'Right now',
        '',
        '',
        <>
          {waitCell('s-6')}
          {act}
        </>,
      )}
    </>
  );
}
export function tPeople() {
  const rows = PEOPLE_T.map((p, __k) => {
    const r = ROLES[p.role],
      v = actsOf(p.id),
      m = 10;
    return (
      <button key={__k} type="button" className={`pp-r${p.off ? ' off' : ''}`} data-person={p.id}>
        {avatar(p.id, p.n)}
        <span className="pp-k">
          <b>{p.n}</b>
          <span className="small quiet">{p.title}</span>
        </span>
        <span className="pp-role">
          <span className={`chip ${p.custom ? 'underway' : 'plain'}`}>{grpName(p)}</span>
        </span>
        <span className="pp-keys">
          <span className={`pp-key${p.passkey ? ' on' : ''}`}>{p.passkey ? ic('check', 'sm') : ''}Passkey</span>
          <span className={`pp-key${p.signer ? ' on' : ''}`}>{p.signer ? ic('check', 'sm') : ''}Safe key</span>
        </span>
        <span className="pp-act">
          {v.map((x, __k) => (
            <i key={__k} style={css(`height:${Math.max(2, (x / m) * 100)}%`)} />
          ))}
        </span>
        <span className="pp-last small quiet">{p.last}</span>
      </button>
    );
  });
  const inv = INVITES.map(([id, n, role, s], __k) => (
    <button key={__k} type="button" className="pp-r inv" data-tflow="invited" data-tid={id}>
      {avatar(id, n, 'dash')}
      <span className="pp-k">
        <b>{n}</b>
        <span className="small quiet">{s}</span>
      </span>
      <span className="pp-role">
        <span className="chip underway">Invited</span>
      </span>
      <span className="pp-keys">
        <span className="pp-key">Passkey</span>
        <span className="pp-key">Safe key</span>
      </span>
      <span className="pp-act" />
      <span className="pp-last small quiet">Not yet</span>
    </button>
  ));
  const list = (
    <section className="cell s-12">
      <header className="c-hd">
        <span className="lbl">Everyone with access</span>
        <span className="tag">Select a person</span>
      </header>
      <div className="c-fig" />
      <div className="c-body start">
        <div className="pp">
          <div className="pp-r pp-h">
            <span />
            <span>Person</span>
            <span>Group</span>
            <span>Keys</span>
            <span>This week</span>
            <span>Last seen</span>
          </div>
          {rows}
          {inv}
        </div>
      </div>
      {strip([
        ['People', String(PEOPLE_T.length)],
        ['Invited', '1'],
        ['Passkeys', `${PEOPLE_T.filter((p) => p.passkey).length} of ${PEOPLE_T.length}`, '', 'warn'],
        ['Signed in on', '8 devices'],
      ])}
    </section>
  );
  const tenure = gCell(
    's-6',
    'Joined',
    'Since the co-op formed',
    figHtml('5', 'people in four months · one more invited'),
    laneFrame(
      <>
        {PEOPLE_T.map((p, __k) => (
          <div key={__k} className="ln-r">
            <span className="ln-k">
              <b>{p.n}</b>
              <span>{ROLES[p.role][0]}</span>
            </span>
            <span className="ln-l">
              <i
                className="gb"
                style={css(`left:${pctX(p.since, D(6, 1), D(11, 15))}%;width:${100 - pctX(p.since, D(6, 1), D(11, 15))}%;background:var(--fg)`)}
              />
            </span>
          </div>
        ))}
        <div className="ln-r">
          <span className="ln-k">
            <b>Priya Shah</b>
            <span>Invited</span>
          </span>
          <span className="ln-l">
            <i
              className="sl-seg proj"
              style={css(`left:${pctX(D(10, 19), D(6, 1), D(11, 15))}%;width:${pctX(D(10, 26), D(6, 1), D(11, 15)) - pctX(D(10, 19), D(6, 1), D(11, 15))}%`)}
            />
          </span>
        </div>
      </>,
      D(6, 1),
      D(11, 15),
      'month',
      'gt',
    ),
    strip([
      ['Longest', 'Kai · Jun'],
      ['Newest', 'Accountant · Oct'],
    ]),
  );
  const sess = gCell(
    's-6',
    'Sign-ins',
    'Last 7 days',
    figHtml('1', 'new device this week · Marcus Lee’s iPhone, confirmed by Kai'),
    <div className="si">
      {SIGNIN.map(([k, n, dev, days, last, flag], __k) => (
        <div key={__k} className="si-r">
          {avatar(k, n)}
          <span className="si-k">
            <b>{n}</b>
            <span className="small quiet">
              {dev}
              {flag ? (
                <>
                  {' · '}
                  <em>{flag}</em>
                </>
              ) : (
                ''
              )}
            </span>
          </span>
          <span className="si-p">
            {days.map((v, __k) => (
              <i key={__k} style={css(`height:${6 + v * 6}px`)} />
            ))}
          </span>
          <span className="small quiet">{last}</span>
        </div>
      ))}
    </div>,
    <div className="c-ft">
      <button type="button" data-rflow="signout">
        <span className="t">Sign someone out everywhere</span>
        {ic('chev', 'sm')}
      </button>
    </div>,
  );
  return (
    <>
      {G('People', '', '', list)}
      {G(
        'Over time',
        '',
        '',
        <>
          {tenure}
          {sess}
        </>,
      )}
    </>
  );
}
export function tRoles() {
  const head = (
    <div className="ax-r ax-h">
      <span />
      {SECS.map(([k, t], __k) => (
        <span key={__k}>{t}</span>
      ))}
    </div>
  );
  const rows = Object.entries(ROLES).map(([k, [n, w, a, auto]], __k) => {
    const c = auto ? MEMBERS_N() : PEOPLE_T.filter((p) => p.role === k).length + INVITES.filter((i) => i[2] === k).length;
    return (
      <button key={__k} type="button" className={`ax-r${auto ? ' ax-m' : ''}`} data-tflow="role" data-tid={k}>
        <span className="ax-k">
          <i className="sg-sq grp" title={`${c} in ${n}`}>
            {c}
          </i>
          <span>
            <b>{n}</b>
            <span>{w}</span>
          </span>
        </span>
        {a.map((v, __k) => (
          <span key={__k} className="ax-c">
            {lvSq(v)}
          </span>
        ))}
      </button>
    );
  });
  const mx = (
    <section className="cell s-12">
      <header className="c-hd">
        <span className="lbl">What each group can do</span>
        <span className="tag">Select a group</span>
      </header>
      <div className="c-fig">{figSide(String(vars.TEAMG.length), 'groups', 'each person is in one, or has custom access · every member is in Members')}</div>
      <div className="c-body start">
        <div className="ax">
          {head}
          {rows}
          <button type="button" className="ax-r ax-new" data-tflow="newgroup">
            <span className="ax-k">
              <i className="sg-sq grp">+</i>
              <span>
                <b>New group</b>
                <span>Pick what it can do</span>
              </span>
            </span>
          </button>
        </div>
        {lvKey()}
      </div>
      {strip([
        ['Approve anything', 'Admin'],
        ['Approve money', 'Admin, Protocol'],
        ['Sign on-chain', 'Admin, Protocol, Board'],
        ['Read-only', 'Members, Outside, Investors'],
        ['Custom access', `${PEOPLE_T.filter((p) => p.custom).length} ${PEOPLE_T.filter((p) => p.custom).length === 1 ? 'person' : 'people'}`],
      ])}
    </section>
  );
  const per = gCell(
    's-6',
    'People per group',
    'Including the invite',
    figHtml('1', 'admin · if Kai is out, nobody else can add or turn off a person'),
    <div className="hbars">
      {Object.entries(ROLES)
        .filter(([k]) => vars.TEAMG.includes(k))
        .map(([k, [n]], __k) => {
          const c = PEOPLE_T.filter((p) => p.role === k).length + INVITES.filter((i) => i[2] === k).length;
          return (
            <div key={__k} className="hb">
              <span className="hb-k">{n}</span>
              <span className="hb-bar">
                <i style={css(`width:${(c / 2) * 100}%;background:var(--fg)`)} />
              </span>
              <b className="num">{c}</b>
            </div>
          );
        })}
    </div>,
    strip([
      ['Groups with one person', '4', '', 'warn'],
      ['Field, after Priya', '2'],
    ]),
  );
  const sp = Object.entries(ROLES)
    .filter(([k]) => vars.TEAMG.includes(k))
    .map(([k, [n, , a]]) => [n, a.filter((v) => v === 4).length]);
  const reach = gCell(
    's-6',
    'Approval reach',
    'Sections a group can approve in',
    figHtml('11 of 11', 'for Admin · every other group approves in three or fewer'),
    columns(sp, {
      hi: 0,
      h: 120,
    }),
    strip([
      ['Widest', 'Admin'],
      ['Narrowest', 'Outside · none'],
    ]),
  );
  return (
    <>
      {G('Groups', '', '', mx)}
      {G(
        'Shape',
        '',
        '',
        <>
          {per}
          {reach}
        </>,
      )}
    </>
  );
}
export function tRule() {
  const rules = (
    <section className="cell s-12">
      <header className="c-hd">
        <span className="lbl">What needs a second person</span>
        <span className="tag">Select a rule</span>
      </header>
      <div className="c-fig">{figHtml(String(RULES2.length), 'kinds of action · the person who proposes can never be the one who approves')}</div>
      <div className="c-body start">
        <div className="rl2">
          <div className="rl2-r rl2-h">
            <span>Rule</span>
            <span>Who can approve</span>
            <span>Last 30 days</span>
            <span>Median wait</span>
          </div>
          {RULES2.map(([r, w, ids, n, h], i) => (
            <button key={i} type="button" className="rl2-r" data-tflow="rule" data-tid={i}>
              <span className="rl2-k">
                <b>{r}</b>
                <span className="small quiet">{w}</span>
              </span>
              <span className="rl2-a">{ids.map((id) => avatar(id, pOf(id).n))}</span>
              <span className="rl2-n">
                <span className="rl2-bar">
                  <i style={css(`width:${(n / 9) * 100}%`)} />
                </span>
                <b className="num">{n}</b>
              </span>
              <span className="rl2-n">
                <span className="rl2-bar">
                  <i style={css(`width:${(h / 8) * 100}%;background:${h > 6 ? 'var(--underway)' : 'var(--fg)'}`)} />
                </span>
                <b className="num">{n ? h.toFixed(1) + ' h' : '—'}</b>
              </span>
            </button>
          ))}
        </div>
      </div>
      {strip([
        ['Approved, 30 days', String(RULES2.reduce((a, r) => a + r[3], 0))],
        ['Self-approved', 'None'],
        ['Slowest', 'On-chain · 7.8 h', '', 'warn'],
        ['Waiting now', String(WAIT2.length)],
      ])}
    </section>
  );
  return (
    <>
      {G('Two-person rule', 'Written in the co-op’s policy v1.2', '', rules)}
      {G(
        'Now',
        '',
        '',
        <>
          {waitCell('s-6', true)}
          {gCell(
            's-6',
            'Who approves whom',
            'Last 30 days',
            figHtml('20', 'approvals · nobody approved their own'),
            apprMatrix(),
            strip([
              ['Waiting', String(WAIT2.length)],
              ['Self-approved', 'None'],
            ]),
          )}
        </>,
      )}
    </>
  );
}

/* ── person panel ─────────────────────────────────────────────────────── */
export function teamPane() {
  if (!TS.person) return '';
  const p = pOf(TS.person);
  if (!p) return '';
  const r = ROLES[p.role],
    recent = LOG.filter((l) => l[2] === p.id).slice(0, 4),
    acc = accOf(p);
  const body = (
    <>
      <div className="pp-hd">
        {avatar(p.id, p.n, 'xl')}
        <div>
          <p className="h2" style={css('font-size:26px')}>
            {p.n}
          </p>
          <p className="quiet" style={css('margin:6px 0 0')}>
            {p.title}
          </p>
        </div>
      </div>
      {sec(
        'Access · ' + (p.off ? 'turned off' : p.custom ? `Custom, from ${r[0]}` : r[0]),
        <>
          <div className="pa">
            {SECS.map(([k, t], i) => (
              <span key={i} className={`pa-c${p.custom && acc[i] !== r[2][i] ? ' chg' : ''}`}>
                {lvSq(acc[i], 1)}
                <span>{t}</span>
              </span>
            ))}
          </div>
          {lvKey()}
          {p.role === 'investors' ? (
            <div className="note">
              {ic('records', 'sm')}
              <span>
                <b>
                  {'Data room until '}
                  {p.title.split('until ')[1] || 'they’re turned off'}.
                </b>{' '}
                {p.terms ? 'Confidentiality terms accepted.' : 'Accepts the confidentiality terms at first sign-in.'}
                {' Every page they open is logged.'}
              </span>
            </div>
          ) : (
            ''
          )}
        </>,
        p.off || p.id === (LIVE ? vars.meId : 'K') ? (
          ''
        ) : (
          <button type="button" className="pn-link" data-tflow="custom" data-tid={p.id}>
            {p.custom ? 'Edit custom access' : 'Customize'}
          </button>
        ),
      )}
      {sec(
        'Keys',
        kv([
          ['Passkey', p.passkey ? 'Set up' : <span style={css('color:var(--underway)')}>Not set up</span>],
          ['Ops Safe', p.signer ? 'Signer, 1 of 3' : 'Not a signer'],
          ['Joined', fmtD(p.since) + ' 2026'],
          ['Last seen', p.last, 1],
        ]),
      )}
      {sec(
        'Devices',
        <div className="pn-list">
          {p.dev.map((d, __k) => (
            <div key={__k} className="pn-r two">
              <span className="pn-k">
                <b>{d.split(' · ')[0]}</b>
                <span className="small quiet">{d.split(' · ').slice(1).join(' · ')}</span>
              </span>
              {d.includes('signed out') ? <span className="chip plain">Signed out</span> : <span className="chip settled">Active</span>}
            </div>
          ))}
        </div>,
      )}
      {recent.length
        ? sec(
            'Recent actions',
            <div className="pn-list">
              {recent.map((l, __k) => (
                <button key={__k} type="button" className="pn-r" data-rflow="entry" data-rid={l[0]}>
                  <span className="ev-d">{fmtD(l[1])}</span>
                  <span className="pn-k">
                    <b>{l[4]}</b>
                    <span className="small quiet">{AREAS[l[3]][0]}</span>
                  </span>
                  <span className={`chip ${RESULT[l[7]][0]}`}>{RESULT[l[7]][1]}</span>
                </button>
              ))}
            </div>,
            <button type="button" className="pn-link" data-rpane="log">
              All
            </button>,
          )
        : ''}
    </>
  );
  const foot = p.off ? (
    <button className="btn btn-p" type="button" data-tflow="turn-on" data-tid={p.id}>
      Turn access back on
    </button>
  ) : p.id === (LIVE ? vars.meId : 'K') ? (
    <button className="btn btn-g" type="button" data-rflow="signout">
      Sign out other devices
    </button>
  ) : (
    <>
      <button className="btn btn-g" type="button" data-tflow="turn-off" data-tid={p.id}>
        Turn off access
      </button>
      <button className="btn btn-p" type="button" data-tflow="role-change" data-tid={p.id}>
        Change group
      </button>
    </>
  );
  return (
    <>
      <div className="pane-scrim" data-closetpane="" />
      <aside className="pane" role="dialog" aria-label="Person">
        <header className="m-hd">
          <span className="sub">Person</span>
          <span style={css('display:flex;align-items:center;gap:8px')}>
            <span className={`chip ${p.off ? 'absent' : p.custom ? 'underway' : 'plain'}`}>{grpName(p)}</span>
            <button className="x" type="button" data-closetpane="" aria-label="Close">
              {ic('close')}
            </button>
          </span>
        </header>
        <div className="pane-mn">{body}</div>
        <footer className="pane-ft">{foot}</footer>
      </aside>
    </>
  );
}

/* ── modals ───────────────────────────────────────────────────────────── */
/* an editable access row: select a section to step it through None → Totals → See → Propose → Approve */
/* ── modals ───────────────────────────────────────────────────────────── */
/* an editable access row: select a section to step it through None → Totals → See → Propose → Approve */
export function accessEdit(a, base) {
  return (
    <div className="pa pa-ed">
      {SECS.map(([k, t], i) => (
        <button key={i} type="button" className={`pa-c${base && base[i] !== a[i] ? ' chg' : ''}`} data-tlv={i} title={`${t}: ${LV[a[i]]} · select to change`}>
          {lvSq(a[i], 1)}
          <span>{t}</span>
          <em>{LV[a[i]]}</em>
        </button>
      ))}
    </div>
  );
}
export function accessRow(a, b) {
  return (
    <div className="pa">
      {SECS.map(([k, t], i) => (
        <span key={i} className={`pa-c${b && b[i] !== a[i] ? ' chg' : ''}`}>
          {lvSq(b ? b[i] : a[i], 1)}
          <span>{t}</span>
        </span>
      ))}
    </div>
  );
}
export function openTFlow(kind, id) {
  vars.lastFocus = document.activeElement;
  let f = null;
  const p = id ? pOf(id) : null;
  const roleSeg = (cur, k, tid) => (
    <div className="seg2" role="group" aria-label="Group">
      {Object.entries(ROLES)
        .filter(([x]) => x !== 'admin' && vars.TEAMG.includes(x))
        .map(([x, [n]], __k) => (
          <button key={__k} type="button" data-trole={x} data-tk={k} data-tid={tid || ''} aria-pressed={x === cur}>
            {n}
          </button>
        ))}
    </div>
  );
  if (kind === 'custom' && p) {
    if (!TS.edit || TS.edit.id !== p.id || TS.edit.kind !== 'custom')
      TS.edit = {
        kind: 'custom',
        id: p.id,
        levels: accOf(p).slice(),
      };
    const base = ROLES[p.role][2],
      diff = TS.edit.levels.filter((v, i) => v !== base[i]).length;
    f = {
      t: 'Custom access',
      lbl: p.n,
      h: diff ? `Custom · ${diff} section${diff === 1 ? ' differs' : 's differ'} from ${ROLES[p.role][0]}` : `Same as ${ROLES[p.role][0]}`,
      p: 'Select a section to change it. Outlined sections differ from their group.',
      pre: (
        <div className="ablock">
          {accessEdit(TS.edit.levels, base)}
          {lvKey()}
        </div>
      ),
      rows: [
        ['Group', ROLES[p.role][0] + ' · stays their group'],
        ['Shows as', diff ? 'Custom' : ROLES[p.role][0]],
        ['Takes effect', 'Their next page load', 1],
      ],
      note: TS.edit.levels.some((v, i) => v === 4 && base[i] < 4) ? (
        <>
          <b>Giving Approve needs a second admin.</b>
          {' It waits in Needs you until someone else signs.'}
        </>
      ) : null,
      noteIc: 'team',
      btn: diff ? 'Save custom access' : p.custom ? 'Reset to the group' : null,
      after: () => {
        p.custom = diff ? TS.edit.levels.slice() : null;
        TS.edit = null;
      },
      api: () => live.teamChange(f, () => live.setAccess(p.id, { custom: live.customLevels(diff ? TS.edit.levels.slice() : null) })).then(() => (TS.edit = null)),
      steps: ['Saved their access', 'Refreshed their session', 'Logged it'],
      done: [diff ? 'Custom access saved.' : 'Back to the group.', diff ? `${p.n} now shows as Custom.` : `${p.n} has ${ROLES[p.role][0]} access again.`],
    };
  } else if (kind === 'newgroup' || kind === 'editgroup') {
    const g = kind === 'editgroup' ? ROLES[id] : null;
    if (!TS.edit || TS.edit.kind !== kind || TS.edit.id !== id)
      TS.edit = {
        kind,
        id,
        levels: (g ? g[2] : ROLES.members[2]).slice(),
        name: g ? g[0] : '',
        desc: g ? g[1] : '',
      };
    const base = g ? g[2] : ROLES.members[2],
      E = TS.edit;
    f = {
      t: g ? 'Edit group' : 'New group',
      lbl: g ? 'Group' : 'New group',
      h: g ? g[0] : 'A group for a kind of person',
      p: g ? 'Everyone in it gets the change on their next page load.' : 'Starts from what every member sees. Select a section to change it.',
      pre: (
        <>
          {g ? (
            ''
          ) : (
            <>
              <label className="field">
                <span className="lbl">Name</span>
                <input id="tg-name" type="text" defaultValue={E.name} placeholder="Lenders" autoComplete="off" />
              </label>
              <label className="field">
                <span className="lbl">Who it’s for</span>
                <input id="tg-desc" type="text" defaultValue={E.desc} placeholder="Banks and CDFIs looking at a credit line" autoComplete="off" />
              </label>
            </>
          )}
          <div className="ablock">
            <span className="lbl">It can</span>
            {accessEdit(E.levels, base)}
            {lvKey()}
          </div>
        </>
      ),
      rows: g
        ? [
            ['People', String(id === 'members' ? MEMBERS_N() : PEOPLE_T.filter((x) => x.role === id).length)],
            ['Changed', `${E.levels.filter((v, i) => v !== base[i]).length} sections`, 1],
          ]
        : [
            ['Starts with', 'Nobody in it'],
            ['Add people', 'From Invite someone, or a person’s panel', 1],
          ],
      note: E.levels.some((v, i) => v === 4 && base[i] < 4) ? <b>Giving Approve needs a second admin.</b> : null,
      noteIc: 'team',
      btn: g ? 'Save the group' : 'Make the group',
      api: () =>
        live
          .teamChange(f, () => (g ? live.editGroup(id, E.levels.slice()) : live.newGroup(E.name || 'New group', E.desc || '', E.levels.slice())))
          .then(() => (TS.edit = null)),
      after: () => {
        if (g) {
          g[2] = E.levels.slice();
        } else {
          const key = 'g' + Date.now().toString(36);
          ROLES[key] = [E.name || 'New group', E.desc || 'Custom group', E.levels.slice()];
          vars.TEAMG = Object.keys(ROLES).filter((k) => !ROLES[k][3]);
        }
        TS.edit = null;
      },
      steps: g ? ['Saved the group', 'Refreshed sessions for everyone in it', 'Logged it'] : ['Made the group', 'Logged it'],
      done: [g ? 'Group saved.' : 'Group made.', g ? 'Everyone in it has the new access.' : 'Invite people into it, or move someone over from their panel.'],
    };
  } else if (kind === 'invite') {
    const r = TS.invRole || 'field';
    f = {
      t: 'Invite someone',
      h: 'A new team member',
      post: (
        <>
          <label className="field">
            <span className="lbl">Name</span>
            <input type="text" {...(LIVE ? { id: 'tf-name', placeholder: 'Their name' } : { defaultValue: 'Jordan Avila' })} autoComplete="off" />
          </label>
          <label className="field">
            <span className="lbl">Email</span>
            <input type="text" {...(LIVE ? { id: 'tf-email', type: 'email', placeholder: 'name@example.com' } : { defaultValue: 'jordan@' })} autoComplete="off" />
          </label>
          <span className="lbl">Group</span>
          {roleSeg(r, 'invite')}
          <div className="ablock">
            <span className="lbl">They’ll be able to</span>
            {accessRow(ROLES[r][2])}
            {lvKey()}
          </div>
        </>
      ),
      rows:
        r === 'investors'
          ? [
              ['Signs in with', 'Their Clear app login, or a new one from the invite'],
              ['Access ends', '30 days after first sign-in'],
              ['Before they look', 'They accept the confidentiality terms'],
              ['Logged', 'Every page they open', 1],
            ]
          : [
              ['Signs in with', 'Their Clear app login, or a new one from the invite'],
              ['Invite lasts', '7 days'],
              ['Second person', 'Not needed to invite · logged', 1],
            ],
      btn: 'Send the invite',
      after: () => {
        INVITES.push(['JA', 'Jordan Avila', r, 'Sent today · expires 29 Oct']);
      },
      api: () => {
        const n = (document.getElementById('tf-name')?.value || '').trim(),
          e = (document.getElementById('tf-email')?.value || '').trim();
        if (!n || !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e)) return Promise.reject(new Error('Add their name and email first'));
        return live.teamChange(f, () => live.invite({ name: n, email: e, group: r }));
      },
      steps: ['Made the invite', 'Sent it by email', 'Logged who sent it'],
      done: ['Invite sent.', 'They show as invited until they first sign in.'],
    };
  } else if (kind === 'role-change' && p) {
    const to = TS.roleTo && TS.roleTo !== p.role ? TS.roleTo : p.role === 'field' ? 'protocol' : 'field';
    const gain = ROLES[to][2].filter((v, i) => v > ROLES[p.role][2][i]).length,
      lose = ROLES[to][2].filter((v, i) => v < ROLES[p.role][2][i]).length;
    f = {
      t: 'Change group',
      lbl: p.n,
      h: `${ROLES[p.role][0]} → ${ROLES[to][0]}`,
      pre: (
        <>
          <span className="lbl">New group</span>
          {roleSeg(to, 'change', p.id)}
          <div className="ablock">
            <span className="lbl">What changes · outlined</span>
            {accessRow(ROLES[p.role][2], ROLES[to][2])}
            {lvKey()}
          </div>
        </>
      ),
      rows: [
        ['Gains', `${gain} section${gain === 1 ? '' : 's'}`],
        ['Loses', `${lose} section${lose === 1 ? '' : 's'}`],
        ['Ops Safe key', p.signer ? 'Unchanged · that’s a multisig change' : 'None'],
        ['Takes effect', 'Their next page load', 1],
      ],
      btn: 'Change the group',
      after: () => {
        p.role = to;
        TS.roleTo = null;
      },
      api: () => live.teamChange(f, () => live.setAccess(p.id, { group: to })).then(() => (TS.roleTo = null)),
      steps: ['Changed the group', 'Refreshed their access', 'Logged it'],
      done: ['Group changed.', `${p.n} is now ${ROLES[to][0]}.`],
    };
  } else if (kind === 'turn-off' && p) {
    f = {
      t: 'Turn off access',
      lbl: p.n,
      h: 'Turn off their access?',
      p: 'They can’t sign in or see anything. Their history stays in the log.',
      rows: [
        ['Sessions', 'Ended on every device'],
        ['Their actions', 'Kept, never deleted'],
        ['Waiting on them', p.id === 'DR' ? 'PayoutPool top-up · Kai can still pick someone else' : 'Nothing'],
        ['Ops Safe key', p.signer ? 'Still a signer until a multisig change removes it' : 'None', 1],
      ],
      note: p.signer ? (
        <>
          <b>Removing a Safe signer is a separate multisig change.</b>
          {' Propose it in Contracts.'}
        </>
      ) : null,
      btn: 'Turn off access',
      after: () => {
        p.off = 1;
      },
      api: () => live.teamChange(f, () => live.setAccess(p.id, { off: true })),
      steps: ['Ended every session', 'Turned off sign-in', 'Logged it'],
      done: ['Access turned off.', 'You can turn it back on any time.'],
    };
  } else if (kind === 'turn-on' && p) {
    f = {
      t: 'Turn access back on',
      h: p.n,
      rows: [
        ['Group', ROLES[p.role][0]],
        ['They’ll need', 'To sign in with their Clear app login', 1],
      ],
      btn: 'Turn it on',
      after: () => {
        p.off = 0;
      },
      api: () => live.teamChange(f, () => live.setAccess(p.id, { off: false })),
      steps: ['Turned sign-in back on', 'Logged it'],
      done: ['Access is back on.', 'Their group is unchanged.'],
    };
  } else if (kind === 'invited') {
    const iv = INVITES.find((x) => x[0] === id);
    f = {
      t: 'Invite',
      lbl: 'Invited',
      h: iv[1],
      rows: [
        ['Group', ROLES[iv[2]][0]],
        ['Status', iv[3]],
        ['Signs in with', 'Their Clear app login', 1],
      ],
      pre: accessRow(ROLES[iv[2]][2]),
      btn: 'Send it again',
      api: () => live.teamChange(f, () => live.resendInvite(id)),
      steps: ['Sent the invite again', 'Reset the 7 days'],
      done: ['Sent again.', 'It now expires 29 Oct.'],
    };
  } else if (kind === 'role') {
    const [n, w, a, auto] = ROLES[id],
      ppl = PEOPLE_T.filter((x) => x.role === id);
    f = {
      t: 'Group',
      lbl: 'Group',
      h: n,
      p: w,
      pre: (
        <div className="ablock">
          <span className="lbl">Access</span>
          {accessRow(a)}
          {lvKey()}
          {id !== 'admin' ? (
            <button type="button" className="pn-link" data-tflow="editgroup" data-tid={id} style={css('align-self:flex-start')}>
              Edit what it can do
            </button>
          ) : (
            ''
          )}
        </div>
      ),
      rows: [
        ['People', auto ? `${MEMBERS_N()} members · everyone with a Clear account` : ppl.map((x) => x.n).join(', ') || 'Nobody yet'],
        ['Approves in', `${a.filter((v) => v === 4).length} sections`],
        ['Can’t open', `${a.filter((v) => v === 0).length} sections`, 1],
      ],
      note: auto ? (
        <>
          <b>Totals means co-op numbers only.</b>
          {' Names, emails and accounts stay hidden.'}
        </>
      ) : id === 'investors' ? (
        <>
          <b>This is the data room.</b>
          {' Access ends after 30 days unless you extend it, and they accept confidentiality terms first.'}
        </>
      ) : null,
      noteIc: id === 'investors' ? 'records' : 'members',
      btn: 'Preview this view',
      go: () => {
        closeModal();
        viewAs(id);
      },
    };
  } else if (kind === 'rule') {
    const [r, w, ids, n, h] = RULES2[+id];
    f = {
      t: 'Two-person rule',
      lbl: 'Rule',
      h: r,
      p: w,
      pre: (
        <div className="ablock">
          <span className="lbl">Can be the second person</span>
          <div className="pn-list">
            {ids.map((x, __k) => (
              <div key={__k} className="pn-r two">
                <span className="pn-k">
                  <b>{pOf(x).n}</b>
                  <span className="small quiet">{ROLES[pOf(x).role][0]}</span>
                </span>
                {avatar(x)}
              </div>
            ))}
          </div>
        </div>
      ),
      rows: [
        ['Last 30 days', `${n} approved`],
        ['Median wait', n ? `${h.toFixed(1)} hours` : 'None yet'],
        ['Proposer approves', 'Never', 1],
      ],
      note: (
        <>
          <b>Changing this rule needs a board vote.</b>
          {' It’s written in the two-person policy, v1.2.'}
        </>
      ),
      noteIc: 'team',
      btn: null,
    };
  }
  if (!f) return;
  vModal(f, 't:' + kind);
}

/* ══ Shop ═══════════════════════════════════════════════════════════════
   The co-op shop on useclear.org/shop. Quality goods, priced so the margin covers the line and funds marketing.
   Ties: Team (Shop column, refunds over $50.00 need a second person, the #1079 refund waiting on Dana Ruiz),
   Records (shop log entries, the returns policy), Governance (the quarterly sales tax return), Merchants
   (pickups at partner shops, hardware pre-orders need a merchant account), Contracts (Inland Cycle Works). */
