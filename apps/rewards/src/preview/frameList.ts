/**
 * Every phone frame in the spec (docs/rewards-reference/clear-rewards-app.html, in order) and where
 * the preview shows it. `frame` is its index among the spec's `.sa-ph` frames. Frames the rewards
 * app doesn't draw: 11 (the Clear app's Your shops, Phase 6), 22 (Settings' preview of Home, which is
 * frame 0), 24 (the lock screen's notification).
 */
export const FRAMES: Array<{ frame: number; name: string; url: string }> = [
  { frame: 0, name: 'Home · Mi Casa · Sofia', url: '/s/micasa?preview=1&as=sofia' },
  { frame: 1, name: 'Home · Mike’s Tire · Sofia', url: '/s/mikes-tire?preview=1&as=sofia' },
  { frame: 2, name: 'Pay: the scanner', url: '/s/micasa/pay?preview=1&as=sofia' },
  { frame: 3, name: 'Table 6, with the reward', url: '/s/micasa/bill/A7K2?preview=1&as=sofia' },
  { frame: 4, name: 'Paid', url: '/s/micasa/paid/ord_table6?preview=1&as=sofia&after=table6' },
  { frame: 5, name: 'Rewards', url: '/s/micasa/rewards?preview=1&as=sofia' },
  { frame: 6, name: 'A reward claimed for the counter', url: '/s/micasa/rewards/rwd_agua?preview=1&as=sofia' },
  { frame: 7, name: 'Join Mi Casa Rewards', url: '/s/micasa?preview=1&as=out' },
  { frame: 8, name: 'Home · Marco, rewards only', url: '/s/micasa?preview=1&as=marco' },
  { frame: 9, name: 'Set up your Clear account', url: '/s/micasa?preview=1&as=marco&sheet=setup' },
  { frame: 10, name: 'You · Mi Casa', url: '/s/micasa/you?preview=1&as=sofia' },
  { frame: 12, name: 'Hub home', url: '/?preview=1&as=sofia' },
  { frame: 13, name: 'Inside a shop, in the hub', url: '/shops/micasa?preview=1&as=sofia' },
  { frame: 14, name: 'Switch shop', url: '/shops/micasa?preview=1&as=sofia&sheet=switch' },
  { frame: 15, name: 'Add a shop', url: '/scan?preview=1&as=sofia' },
  { frame: 16, name: 'Join Peña Coffee', url: '/scan?preview=1&as=sofia&join=pena-coffee' },
  { frame: 17, name: 'Paid somewhere new', url: '/shops/pena-coffee/paid/ord_pena?preview=1&as=sofia' },
  { frame: 18, name: 'Sign in: phone and code', url: '/?preview=1&as=out&step=code' },
  { frame: 19, name: 'Already have Clear?', url: '/?preview=1&as=out&step=already' },
  { frame: 20, name: 'Welcome', url: '/?preview=1&as=out&step=welcome' },
  { frame: 21, name: 'You · hub', url: '/you?preview=1&as=sofia' },
  { frame: 23, name: 'Home · La Bonita, stamps', url: '/s/la-bonita?preview=1&as=sofia' },
  { frame: 25, name: 'Approve, from the counter', url: '/s/micasa/c/CLRTBL6X?preview=1&as=sofia' },
];
