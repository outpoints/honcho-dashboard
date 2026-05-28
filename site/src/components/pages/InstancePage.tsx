"use client";

import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { StatusBar } from "@/components/StatusBar";
import { Button, Chip, RefreshButton } from "@/components/atoms";
import { Icon, type IconName } from "@/components/icons";
import { useToast } from "@/components/toast";
import { SERVICE_STATUSES } from "@/lib/data";

export function InstancePage() {
  const { push } = useToast();
  return (
    <div className="space-y-3">
      <PageHeader
        title="INSTANCE"
        subtitle="self-hosted Honcho instance status and management"
        actions={<RefreshButton label="REFRESH" onClick={() => push({ type: "success", message: "Instance status refreshed" })} />}
      />

      <div className="flex items-center justify-between p-4 bg-accent/5 border border-accent/30">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 border border-accent/40 bg-accent/10 text-accent flex items-center justify-center">
            <Icon name="check" size={18} />
          </div>
          <div>
            <div className="text-sm uppercase tracking-wider">ALL_SYSTEMS_OPERATIONAL</div>
            <div className="text-[10px] text-text-muted">Last checked: 5/28/2026, 1:45:02 AM</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-text-muted">uptime</div>
          <div className="font-pixel text-2xl text-accent">14d 7h 23m</div>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-12 lg:col-span-8 space-y-3">
          <Panel title="SERVICE_STATUS">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {SERVICE_STATUSES.map((s) => (
                <div key={s.id} className="flex items-center gap-3 p-3 bg-void/40 border border-accent/30 border-l-2 border-l-accent">
                  <Icon name={s.icon as IconName} className="text-accent shrink-0" size={16} />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-text-primary">{s.name}</div>
                    <div className="text-[10px] text-text-muted">{s.detail}</div>
                  </div>
                  <Chip tone="accent">{s.status}</Chip>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="INSTANCE_STATS">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <SmallStat label="workspaces" value="3" />
              <SmallStat label="peers" value="1,304" />
              <SmallStat label="sessions" value="9,257" />
              <SmallStat label="messages" value="252,590" />
              <SmallStat label="conclusions" value="90,468" />
              <SmallStat label="db_size" value="4.2 GB" />
              <SmallStat label="vectors" value="2,412,847" />
              <SmallStat label="queue" value="23 pending" tone="accent" />
            </div>
          </Panel>
        </div>

        <div className="col-span-12 lg:col-span-4 space-y-3">
          <Panel title="VERSION_INFO">
            <div className="space-y-2 text-xs">
              {[
                ["honcho_version", "v3.0.5"],
                ["llm_provider", "openai"],
                ["llm_model", "gpt-5.4"],
                ["reasoning_workers", "4"],
                ["batch_threshold", "1000 tokens"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between py-1.5 border-b border-border last:border-0">
                  <span className="text-text-muted">{k}</span>
                  <span className="text-accent">{v}</span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="ADMIN_ACTIONS">
            <div className="space-y-2">
              <Button variant="secondary" icon="download" className="w-full !justify-start" onClick={() => push({ type: "success", message: "Backup exported (mock)" })}>EXPORT_BACKUP</Button>
              <RefreshButton label="REINDEX_VECTORS" onClick={() => push({ type: "success", message: "Vector index rebuilt" })} />
              <Button variant="warning" icon="trash" className="w-full !justify-start" onClick={() => push({ type: "success", message: "Cache flushed" })}>FLUSH_CACHE</Button>
              <div className="pt-2 mt-2 border-t border-border space-y-1 text-[10px] text-text-muted">
                <div>&gt; last_backup: <span className="text-text-primary">2026-01-20 03:00 UTC</span></div>
                <div>&gt; last_reindex: <span className="text-text-primary">2026-01-19 12:00 UTC</span></div>
              </div>
            </div>
          </Panel>

          <Panel title="CONNECTION_INFO">
            <div className="space-y-2 text-xs">
              <div>
                <div className="text-[10px] text-text-muted uppercase tracking-wider mb-1">postgres_url</div>
                <div className="px-2 py-1.5 bg-void border border-border text-[11px] text-text-primary break-all">postgresql://localhost:5432/honcho</div>
              </div>
              <div className="flex justify-between py-1.5 border-t border-border pt-2">
                <span className="text-text-muted">webhooks</span>
                <span className="text-accent">ENABLED</span>
              </div>
            </div>
          </Panel>
        </div>
      </div>

      <StatusBar />
    </div>
  );
}

function SmallStat({ label, value, tone = "primary" }: { label: string; value: string; tone?: "primary" | "accent" }) {
  return (
    <div className="bg-void/40 border border-border p-3">
      <div className="text-[10px] text-text-muted uppercase tracking-wider mb-1">{label}</div>
      <div className={`font-pixel text-2xl tracking-wider ${tone === "accent" ? "text-accent" : "text-text-primary"}`}>{value}</div>
    </div>
  );
}
