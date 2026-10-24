// Vercel Serverless Function — /api/attendance
// DB: LabAttendanceDB_MARQUEZ.daily_attendance
// Student doc: { student_id, student_name, subject_name, course,
//                attendance_records: [{date, status, time}] }
//
// Optional protection: set an ADMIN_KEY environment variable in Vercel.
// When set, POST / PUT / DELETE must send the header  X-Admin-Key: <ADMIN_KEY>.
// GET (viewing) stays public. If ADMIN_KEY is not set, behaviour is unchanged.

const mongoose = require("mongoose");
const crypto = require("crypto");

const DB = "LabAttendanceDB_MARQUEZ";
const COL = "daily_attendance";
const STATUSES = ["Present", "Absent", "Late"];

// Cache the connection *promise* so parallel requests share one connection attempt.
let connPromise = null;
async function getCol() {
  if (!connPromise) {
    connPromise = mongoose
      .connect(process.env.MONGODB_URI, { dbName: DB })
      .catch(err => { connPromise = null; throw err; }); // allow a retry on the next request
  }
  await connPromise;
  return mongoose.connection.db.collection(COL);
}

// Philippine-time helpers
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }); // YYYY-MM-DD
const nowTime = () => new Date().toLocaleTimeString("en-US", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit" });

// Accept only real calendar dates in YYYY-MM-DD format
function isValidDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Accept only YYYY-MM (month 01-12)
const isValidMonth = s => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

// Constant-time comparison for the admin key
function keyMatches(provided) {
  const expected = Buffer.from(process.env.ADMIN_KEY);
  const given = Buffer.from(String(provided || ""));
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Admin-Key");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // Block changes unless the admin key matches (only when ADMIN_KEY is configured)
    if (req.method !== "GET" && process.env.ADMIN_KEY && !keyMatches(req.headers["x-admin-key"])) {
      return res.status(401).json({ error: "Admin key required." });
    }

    const collection = await getCol(); // inside try/catch so DB failures return a clean 500

    // ---------- GET /api/attendance?month=YYYY-MM  (monthly summary) ----------
    if (req.method === "GET" && req.query.month) {
      const month = req.query.month;
      if (!isValidMonth(month)) return res.status(400).json({ error: "month must be YYYY-MM." });

    const students = await collection.find({}).sort({ _id: 1 }).toArray();
      const perDay = {};

      const list = students.map(s => {
        const c = { Present: 0, Absent: 0, Late: 0 };
        (s.attendance_records || []).forEach(r => {
          if (typeof r.date !== "string" || !r.date.startsWith(month + "-") || !STATUSES.includes(r.status)) return;
          c[r.status]++;
          if (!perDay[r.date]) perDay[r.date] = { date: r.date, Present: 0, Absent: 0, Late: 0 };
          perDay[r.date][r.status]++;
        });
        const marked = c.Present + c.Absent + c.Late;
        return {
          student_id: s.student_id,
          student_name: s.student_name,
          subject_name: s.subject_name,
          course: s.course,
          present: c.Present, late: c.Late, absent: c.Absent, marked,
          // Attendance rate = (Present + Late) / days marked, one decimal place
          rate: marked ? Math.round(((c.Present + c.Late) / marked) * 1000) / 10 : null,
        };
      });

      return res.json({
        month,
        days: Object.values(perDay).sort((a, b) => a.date.localeCompare(b.date)),
        students: list,
      });
    }

    // ---------- GET /api/attendance?date=YYYY-MM-DD ----------
    if (req.method === "GET") {
      const date = req.query.date || today();
      if (!isValidDate(date)) return res.status(400).json({ error: "date must be YYYY-MM-DD." });

      const students = await collection.find({}).sort({ student_id: 1 }).toArray();
      return res.json(students.map(s => {
        const rec = (s.attendance_records || []).find(r => r.date === date);
        return {
          student_id: s.student_id,
          student_name: s.student_name,
          subject_name: s.subject_name,
          course: s.course,
          status: rec ? rec.status : null,
          time: rec ? rec.time : null,
        };
      }));
    }

    // ---------- POST /api/attendance  (mark NEW) ----------
    if (req.method === "POST") {
      const { student_id, status, date } = req.body || {};
      const target = date || today();

      // CREATE: add a brand-new student ...
      if (req.body && req.body.create === true) {
         ...
      }

      // BULK: mark every student who has no record yet for this date
      if (req.body && req.body.bulk === true) {
         ...
      }

      if (!student_id || !STATUSES.includes(status))
        return res.status(400).json({ error: "student_id and status ..." });

      // BULK: mark every student who has no record yet for this date
      // CREATE: add a brand-new student with the next student_id (STU016, STU017, ...)
      if (req.body && req.body.create === true) {
        const name = String(req.body.student_name || "").trim().slice(0, 100);
        const subject = String(req.body.subject_name || "").trim().slice(0, 100);
        const courseName = String(req.body.course || "").trim().slice(0, 50);
        if (!name || !subject || !courseName)
          return res.status(400).json({ error: "Student name, subject and course are required." });
        if (status && !STATUSES.includes(status))
          return res.status(400).json({ error: "status must be Present, Absent or Late." });
        if (!isValidDate(target)) return res.status(400).json({ error: "date must be YYYY-MM-DD." });

        // A unique index makes two simultaneous creates unable to share one ID
        try { await collection.createIndex({ student_id: 1 }, { unique: true }); } catch (e) { /* already exists */ }

        for (let attempt = 0; attempt < 5; attempt++) {
          const all = await collection.find({}, { projection: { student_id: 1 } }).toArray();
          const highest = all.reduce((m, s) => Math.max(m, parseInt(String(s.student_id).replace(/\D/g, ""), 10) || 0), 0);
          const newId = "STU" + String(highest + 1).padStart(3, "0");
          try {
            await collection.insertOne({
              student_id: newId,
              student_name: name,
              subject_name: subject,
              course: courseName,
              attendance_records: status ? [{ date: target, status, time: nowTime() }] : []
            });
            return res.status(201).json({ ok: true, student_id: newId });
          } catch (err) {
            if (err.code !== 11000) throw err;   // retry only when the ID was just taken
          }
        }
        return res.status(409).json({ error: "Could not assign a new student ID. Please try again." });
      }

    // ---------- PUT /api/attendance  (EDIT existing) ----------
    if (req.method === "PUT") {
      const { student_id, status, date, student_name, subject_name, course } = req.body || {};

      // Edit student details (name / subject / course)
      if (student_name !== undefined || subject_name !== undefined || course !== undefined) {
        const name = String(student_name || "").trim().slice(0, 100);
        if (!student_id || !name)
          return res.status(400).json({ error: "student_id and student_name are required." });
        const result = await collection.updateOne(
          { student_id },
          { $set: {
              student_name: name,
              subject_name: String(subject_name || "").trim().slice(0, 100),
              course: String(course || "").trim().slice(0, 50)
          } }
        );
        if (!result.matchedCount) return res.status(404).json({ error: "Student not found." });
        return res.json({ ok: true, student_id });
      }

      const target = date || today();
      if (!student_id || !STATUSES.includes(status))
        return res.status(400).json({ error: "student_id and status (Present/Absent/Late) are required." });
      if (!isValidDate(target)) return res.status(400).json({ error: "date must be YYYY-MM-DD." });

      const result = await collection.updateOne(
        { student_id, "attendance_records.date": target },
        { $set: { "attendance_records.$.status": status, "attendance_records.$.time": nowTime() } }
      );
      if (!result.matchedCount) return res.status(404).json({ error: "No record for that date." });
      return res.json({ ok: true, student_id, date: target, status });
    }

    // ---------- DELETE /api/attendance?student_id=X&date=YYYY-MM-DD ----------
    if (req.method === "DELETE") {
      const { student_id, date } = req.query;
      const target = date || today();
      if (!student_id) return res.status(400).json({ error: "student_id is required." });
      if (!isValidDate(target)) return res.status(400).json({ error: "date must be YYYY-MM-DD." });

      const result = await collection.updateOne(
        { student_id },
        { $pull: { attendance_records: { date: target } } }
      );
      if (!result.modifiedCount) return res.status(404).json({ error: "No record to delete." });
      return res.json({ ok: true, student_id, date: target });
    }

    res.setHeader("Allow", "GET,POST,PUT,DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
};