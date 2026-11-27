"use strict";
const { json } = require("../_lib/auth");
const {
  requireStudent, text, array, idValue, ownedCourseRows, getOwnedCourse,
  userLookup, EXAMS, ATTEMPTS
} = require("./_lib");

function attemptSummary(row) {
  return {
    id: String(row._id),
    examId: String(row.examId || ""),
    score: Number(row.score || 0),
    total: Number(row.total || 0),
    percentage: Number(row.percentage || 0),
    submittedAt: row.submittedAt || row.createdAt || null
  };
}

module.exports = async function(req, res) {
  try {
    const auth = await requireStudent(req);
    if (!auth.ok) return json(res, auth.status, { ok: false, message: auth.message });

    if (req.method === "GET") {
      const courses = await ownedCourseRows(auth.database, auth.user);
      const courseIds = courses.map(course => course.id);
      if (!courseIds.length) return json(res, 200, { ok: true, exams: [], attempts: [] });
      const examRows = await auth.database.collection(EXAMS).find({
        courseId: { $in: courseIds },
        deletedAt: { $exists: false },
        status: "active",
        isActive: { $ne: false }
      }).sort({ createdAt: -1 }).limit(500).toArray();
      const attempts = await auth.database.collection(ATTEMPTS).find(userLookup(auth.user))
        .sort({ submittedAt: -1, createdAt: -1 }).limit(1000).toArray();
      const grouped = new Map();
      for (const attempt of attempts) {
        const examId = String(attempt.examId || "");
        if (!grouped.has(examId)) grouped.set(examId, []);
        grouped.get(examId).push(attemptSummary(attempt));
      }
      const exams = examRows.map(exam => ({
        id: String(exam._id),
        courseId: String(exam.courseId),
        courseTitle: text(exam.courseTitle, 240),
        title: text(exam.title, 240),
        questionCount: array(exam.questions).length,
        questions: array(exam.questions).map(question => ({
          id: text(question.id, 100),
          text: text(question.text || question.q, 2000),
          options: array(question.options).map(option => text(option, 500)),
          required: question.required !== false
        })),
        attempts: grouped.get(String(exam._id)) || []
      }));
      return json(res, 200, { ok: true, exams, attempts: attempts.map(attemptSummary) });
    }

    if (req.method === "POST") {
      const examId = text(req.body?.examId, 100);
      if (!examId) return json(res, 400, { ok: false, message: "معرف الامتحان مطلوب." });
      const exam = await auth.database.collection(EXAMS).findOne({
        _id: idValue(examId),
        deletedAt: { $exists: false },
        status: "active",
        isActive: { $ne: false }
      });
      if (!exam) return json(res, 404, { ok: false, message: "الامتحان غير متاح حالياً." });
      const course = await getOwnedCourse(auth.database, auth.user, String(exam.courseId));
      if (!course) return json(res, 403, { ok: false, message: "يجب تفعيل الكورس المرتبط بهذا الامتحان أولاً." });

      const questions = array(exam.questions);
      if (!questions.length) return json(res, 409, { ok: false, message: "هذا الامتحان لا يحتوي على أسئلة بعد." });
      const submitted = req.body?.answers;
      const answerMap = new Map();
      if (Array.isArray(submitted)) {
        submitted.forEach(item => answerMap.set(String(item.questionId || item.id || ""), Number(item.optionIndex)));
      } else if (submitted && typeof submitted === "object") {
        Object.entries(submitted).forEach(([id, value]) => answerMap.set(String(id), Number(value)));
      }
      const missing = questions.find(question => question.required !== false &&
        (!answerMap.has(String(question.id)) || !Number.isInteger(answerMap.get(String(question.id)))));
      if (missing) {
        return json(res, 400, { ok: false, message: "أجب عن جميع الأسئلة المطلوبة قبل تسليم الامتحان." });
      }
      const results = questions.map(question => {
        const selectedIndex = answerMap.has(String(question.id)) ? answerMap.get(String(question.id)) : -1;
        const correctIndex = Number(question.correctIndex);
        const isCorrect = Number.isInteger(correctIndex) && selectedIndex === correctIndex;
        return {
          questionId: text(question.id, 100),
          text: text(question.text || question.q, 2000),
          options: array(question.options).map(option => text(option, 500)),
          selectedIndex,
          correctIndex,
          isCorrect
        };
      });
      const score = results.filter(result => result.isCorrect).length;
      const total = results.length;
      const percentage = total ? Math.round((score / total) * 10000) / 100 : 0;
      const now = new Date();
      const inserted = await auth.database.collection(ATTEMPTS).insertOne({
        examId: String(exam._id),
        examTitle: text(exam.title, 240),
        courseId: String(exam.courseId),
        userId: auth.user._id,
        studentId: auth.user._id,
        email: text(auth.user.email, 254).toLowerCase(),
        studentName: auth.user.fullName || auth.user.name || "",
        answers: results,
        score,
        total,
        percentage,
        status: "submitted",
        createdAt: now,
        submittedAt: now
      });
      return json(res, 200, {
        ok: true,
        message: "تم تسليم الامتحان وحفظ نتيجتك.",
        attempt: { id: String(inserted.insertedId), score, total, percentage, submittedAt: now },
        results
      });
    }

    res.setHeader("Allow", "GET, POST");
    return json(res, 405, { ok: false, message: "طريقة الطلب غير مدعومة." });
  } catch (error) {
    console.error("student exams failed:", error.message);
    return json(res, 500, { ok: false, message: "تعذر تحميل أو حفظ الامتحانات حالياً." });
  }
};
