/**
 * Temporary stand-in for the member-app rebuild.
 *
 * The previous nav pages now live in `src/pages/_archive/` and are no longer
 * routed. Each route below is replaced by its real page as the rebuild works
 * through the build order in `docs/ux/clear-app-design-spec.md` §10.
 * Delete this file once every route has a real page.
 */
export default function RebuildPlaceholder({ page }: { page: string }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2 px-6 text-center">
      <p className="text-sm font-medium text-foreground">{page}</p>
      <p className="text-sm text-muted-foreground">
        Not built yet — this page is part of the member-app rebuild.
      </p>
    </div>
  );
}
