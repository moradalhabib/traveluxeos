-- Run this once in your Supabase SQL Editor (Database → SQL Editor → New query)

CREATE TABLE IF NOT EXISTS follow_ups (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  client_id       UUID REFERENCES clients(id) ON DELETE SET NULL,
  driver_id       UUID,
  due_date        DATE,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'done', 'booked_return', 'no_response')),
  notes           TEXT,
  completed_by    UUID,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_follow_ups_booking_id ON follow_ups (booking_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_status     ON follow_ups (status);
CREATE INDEX IF NOT EXISTS idx_follow_ups_due_date   ON follow_ups (due_date);

-- Enable Row Level Security (optional but recommended)
ALTER TABLE follow_ups ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read/write follow_ups
CREATE POLICY "Authenticated users can manage follow_ups"
  ON follow_ups
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
