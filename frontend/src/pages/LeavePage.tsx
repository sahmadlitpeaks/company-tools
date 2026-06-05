import { CalendarOff, Plane } from "lucide-react";
import { api } from "../api/client";
import type { LeaveBalance, WhosOutItem } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { useAuth } from "../auth/AuthContext";
import { Loading, PageHead, useToast } from "../components/ui";

export default function LeavePage() {
  const { user } = useAuth();
  const { notify } = useToast();
  const balance = useFetch<LeaveBalance>("/api/leave/balance");
  const out = useFetch<WhosOutItem[]>("/api/leave/whos-out?days=30");
  const team = useFetch<LeaveBalance[]>(
    user?.is_admin || user?.role === "manager" ? "/api/leave/balances" : null,
  );

  async function setEntitlement(b: LeaveBalance, value: number) {
    await api(`/api/leave/balances/${b.user_id}`, {
      method: "PUT",
      body: { entitlement_days: value },
    });
    notify("Entitlement updated.");
    team.reload();
    balance.reload();
  }

  const b = balance.data;

  return (
    <div>
      <PageHead title="Leave" subtitle="Your balance, and who's off across the team." />

      <div className="grid cols-4 mb-5">
        <Stat value={b?.entitlement_days ?? "—"} label={`Entitlement ${b?.year ?? ""}`} />
        <Stat value={b?.used_days ?? "—"} label="Days taken" />
        <Stat value={b?.remaining_days ?? "—"} label="Days remaining" accent />
        <div className="card stat">
          <div className="value" style={{ fontSize: 22 }}>
            <Plane size={22} className="text-brand-600" />
          </div>
          <div className="label">Request leave from Approvals →</div>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h3 className="mt-0 inline-flex items-center gap-2">
            <CalendarOff size={18} className="text-brand-600" /> Who's out (next 30 days)
          </h3>
          {out.loading ? (
            <Loading />
          ) : (out.data?.length ?? 0) === 0 ? (
            <p className="muted">Everyone's in. 🎉</p>
          ) : (
            <table>
              <tbody>
                {out.data!.map((o, i) => (
                  <tr key={i}>
                    <td className="font-semibold">{o.user_name ?? "—"}</td>
                    <td className="muted text-sm">
                      {o.start_date}
                      {o.end_date && o.end_date !== o.start_date ? ` → ${o.end_date}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {team.data && (
          <div className="card">
            <h3 className="mt-0">Team balances</h3>
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Entitlement</th>
                  <th>Used</th>
                  <th>Left</th>
                </tr>
              </thead>
              <tbody>
                {team.data.map((m) => (
                  <tr key={m.user_id}>
                    <td className="font-semibold">{m.user_name}</td>
                    <td>
                      {user?.is_admin ? (
                        <input
                          type="number"
                          defaultValue={m.entitlement_days}
                          className="!w-16 !py-1 text-sm"
                          onBlur={(e) => {
                            const v = Number(e.target.value);
                            if (v !== m.entitlement_days) setEntitlement(m, v);
                          }}
                        />
                      ) : (
                        m.entitlement_days
                      )}
                    </td>
                    <td>{m.used_days}</td>
                    <td>
                      <span className={`badge ${m.remaining_days <= 0 ? "red" : "green"}`}>
                        {m.remaining_days}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ value, label, accent }: { value: React.ReactNode; label: string; accent?: boolean }) {
  return (
    <div className="card stat">
      <div className="value" style={{ color: accent ? "var(--brand-600)" : undefined }}>
        {value}
      </div>
      <div className="label">{label}</div>
    </div>
  );
}
