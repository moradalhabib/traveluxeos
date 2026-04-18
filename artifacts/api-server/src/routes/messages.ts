import { Router } from "express";
import { supabase, getUserFromToken } from "../lib/supabase";

const router = Router();

router.get("/", async (req, res) => {
  const { channel, recipient_id } = req.query;

  let query = supabase
    .from("messages")
    .select("*, users!messages_sender_id_fkey(name)")
    .order("created_at", { ascending: true })
    .limit(200);

  if (channel) {
    query = query.eq("channel", String(channel));
  } else if (recipient_id) {
    const user = await getUserFromToken(req.headers.authorization);
    const uid = user?.id;
    if (uid) {
      query = query.or(
        `and(sender_id.eq.${uid},recipient_id.eq.${recipient_id}),and(sender_id.eq.${recipient_id},recipient_id.eq.${uid})`
      );
    }
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const result = (data ?? []).map((m: any) => ({
    ...m,
    sender_name: m.users?.name ?? null,
    users: undefined,
  }));

  return res.json(result);
});

router.post("/", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  const { channel, recipient_id, content } = req.body;

  if (!content) return res.status(400).json({ error: "content is required" });

  const { data, error } = await supabase
    .from("messages")
    .insert({
      channel: channel ?? null,
      sender_id: user?.id ?? null,
      recipient_id: recipient_id ?? null,
      content,
    })
    .select("*, users!messages_sender_id_fkey(name)")
    .single();

  if (error) return res.status(400).json({ error: error.message });

  return res.status(201).json({
    ...data,
    sender_name: data.users?.name ?? user?.name ?? null,
    users: undefined,
  });
});

export default router;
