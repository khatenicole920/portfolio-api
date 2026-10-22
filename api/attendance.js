// Vercel Serverless Function — /api/attendance
// Uses Mongoose (already in your package.json) to talk to
// LabAttendanceDB_MARQUEZ.daily_attendance
// Student doc: { student_id, student_name, subject_name, course,
//                attendance_records: [{date, status, time}] }

const mongoose = require("mongoose");

const DB = "LabAttendanceDB_MARQUEZ";
const COL = "daily_attendance";
const STATUSES = ["Present", "Absent", "Late"];

let conn = null;
async function getCol() {
  if (!conn) {
    conn = await mongoose.connect(process.env.MONGODB_URI, { dbName: DB });
  }
  return mongoose.connection.db.collection(COL);
}

// Philippine-time helpers
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }); // YYYY-MM-DD
const nowTime = () => new Date().toLocaleTimeString("en-US", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit" });

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const collection = await getCol();

  try {
    // ---------- GET /api/attendance?date=YYYY-MM-DD ----------
    if (req.method === "GET") {
      const date = req.query.date || today();
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
      if (!student_id || !STATUSES.includes(status))
        return res.status(400).json({ error: "student_id and status (Present/Absent/Late) are required." });

      const student = await collection.findOne({ student_id });
      if (!student) return res.status(404).json({ error: "Student not found." });
      if ((student.attendance_records || []).some(r => r.date === target))
        return res.status(409).json({ error: "Already marked for this date. Use Edit instead." });

      await collection.updateOne(
        { student_id },
        { $push: { attendance_records: { date: target, status, time: nowTime() } } }
      );
      return res.json({ ok: true, student_id, date: target, status });
    }

    // ---------- PUT /api/attendance  (EDIT existing) ----------
    if (req.method === "PUT") {
      const { student_id, status, date } = req.body || {};
      const target = date || today();
      if (!student_id || !STATUSES.includes(status))
        return res.status(400).json({ error: "student_id and status (Present/Absent/Late) are required." });

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
