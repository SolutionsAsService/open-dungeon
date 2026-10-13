import { localModeSync } from './mode';

/** Shown when no server is behind the page (static hosting): everything runs and is stored in this browser. */
export function LocalModeNotice({ className = '' }: { className?: string }) {
  if (!localModeSync()) return null;
  return (
    <p data-testid="local-mode" role="note" className={'rounded-md border border-line bg-panel-2 p-2 text-xs leading-relaxed text-ink ' + className}>
      <b className="text-accent">Playing in this browser.</b> No server answered, so campaigns, maps and tables are kept on this
      device only. Inviting players on other devices needs the Open Tabletop server —{' '}
      <a className="underline" href="https://github.com/SolutionsAsService/open-dungeon/blob/main/docs/development/deployment.md">host it</a>.
    </p>
  );
}
