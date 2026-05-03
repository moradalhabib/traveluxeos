import { Router, type IRouter, type Request, type Response } from "express";
import { getServiceRoleClient, getUserFromToken, auditLog } from "../lib/supabase";
import { hashPin, isValidPin } from "../lib/api-keys";

const router: IRouter = Router();

async function requireAdmin(req: Request, res: Response): Promise<{ id: string; role: string } | null> {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return null; }
  if (user.role !== "Super Admin" && user.role !== "Admin") {
    res.status(403).json({ error: "Admins only." }); return null;
  }
  return user;
}

async function revokeDriverSessions(sb: ReturnType<typeof getServiceRoleClient>, driverId: string): Promise<void> {
  if (!sb) return;
  await sb
    .from("driver_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("driver_id", driverId)
    .is("revoked_at", null);
}

router.put("/:id/pin", async (req, res) => {
  const user = await requireAdmin(req, res);
  if (!user) return;
  const sb = getServiceRoleClient();
  if (!sb) return res.status(503).json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured." });

  const pin = req.body?.pin;
  if (pin === null || pin === "") {
    const { data, error } = await sb
      .from("drivers")
      .update({ pin_hash: null })
      .eq("id", req.params.id)
      .select("id, name")
      .single();
    if (error) return res.status(404).json({ error: "Driver not found." });
    // Disabling access must also kill any live session.
    await revokeDriverSessions(sb, req.params.id);
    await auditLog("clear_driver_pin", "driver", data.id, user.id, `Cleared Drivers App PIN for ${data.name}`);
    return res.json({ ok: true, cleared: true });
  }

  if (!isValidPin(pin)) return res.status(400).json({ error: "PIN must be 4-6 digits." });

  const { data, error } = await sb
    .from("drivers")
    .update({ pin_hash: hashPin(pin) })
    .eq("id", req.params.id)
    .select("id, name")
    .single();
  if (error) return res.status(404).json({ error: "Driver not found." });
  await auditLog("set_driver_pin", "driver", data.id, user.id, `Set Drivers App PIN for ${data.name}`);

  // Rotate: revoke any existing sessions so the driver must log in again with the new PIN.
  await revokeDriverSessions(sb, req.params.id);

  return res.json({ ok: true });
});

export default router;
