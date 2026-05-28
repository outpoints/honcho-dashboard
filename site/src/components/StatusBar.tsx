export function StatusBar() {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-surface border border-border text-[10px]">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 bg-accent" />
          <span className="text-text-muted">instance:</span>
          <span className="text-accent">healthy</span>
        </span>
        <span className="text-text-muted">|</span>
        <span><span className="text-text-muted">workspaces:</span> <span className="text-text-primary">3</span></span>
        <span className="text-text-muted">|</span>
        <span><span className="text-text-muted">peers:</span> <span className="text-text-primary">1,304</span></span>
        <span className="text-text-muted">|</span>
        <span><span className="text-text-muted">queue:</span> <span className="text-accent">4 pending</span></span>
      </div>
      <div className="flex items-center gap-2">
        <span><span className="text-text-muted">postgres:</span> <span className="text-accent">connected</span></span>
        <span className="text-text-muted">|</span>
        <span><span className="text-text-muted">honcho:</span> <span className="text-text-primary">v3.0.5</span></span>
      </div>
    </div>
  );
}
