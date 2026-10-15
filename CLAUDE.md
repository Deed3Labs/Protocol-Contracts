# CLAUDE.md

## Pushing and Vercel previews

Every push to a branch can start a Vercel build of `apps/member` and `apps/merchant`, and those builds are billed. `scripts/vercel-ignore.sh` decides which ones run:

- Production (`main`) always builds.
- `dev` builds an app whenever a push changes something that app is built from: its folder, the `packages/*` it uses, or the root install files. demo.useclear.org and merchant.useclear.org follow `dev`.
- Other branches only get previews once they have a pull request, and then by the same rule.

So:

- Commit as often as you like, but push at the end of a phase or a hard stop, not after every commit.
- The first push of a new branch happens before its PR exists, so it gets no preview. If you need one straight away, open the PR and push again.
- For pushes that only touch docs or prompts, put `[skip preview]` in the commit message.
