/* scripts/test-keywords.mjs — ตรวจเครื่องยนต์จับคำสำคัญ
   1) ทุกหมวดต้องจับคำตัวอย่างจริงที่ชาวบ้านน่าจะพิมพ์ได้ (กันแก้ regex แล้วพังโดยไม่รู้ตัว)
   2) คำเร่งด่วนต้องจับได้ และไม่ทับซ้อนกับหมวดปกติจนสร้างความสับสน
   3) เตือน (ไม่ล้ม) รายการหมวดที่ยัง reviewed:false — กันลืมส่งนิติกรตรวจก่อนเปิดใช้จริง */
import assert from "node:assert/strict";
import { TOPICS, URGENT_PATTERNS, matchTopic, matchUrgent, UNREVIEWED_TOPICS } from "../api/_keywords.js";

const SAMPLES = {
  scam: ["ถูกโกงเงินจากการซื้อของออนไลน์", "โดนแก๊งคอลเซ็นเตอร์หลอกให้โอนเงิน", "ของไม่ตรงปกไม่คืนเงิน"],
  debt: ["เป็นหนี้บัตรเครดิตจ่ายไม่ไหว", "ถูกทวงหนี้นอกระบบดอกเบี้ยโหด", "ได้รับหมายศาลเรื่องหนี้"],
  inheritance: ["พ่อเสียชีวิตแล้วแบ่งมรดกกันไม่ได้", "อยากทำพินัยกรรม", "อยากเป็นผู้จัดการมรดก"],
  labor: ["ถูกเลิกจ้างไม่ได้ค่าชดเชย", "นายจ้างค้างเงินเดือน 3 เดือน", "ไม่ได้ค่าจ้างตามที่ตกลง"],
  divorce: ["อยากหย่ากับสามี", "ฟ้องหย่าแบ่งสินสมรสยังไง", "ค่าเลี้ยงดูบุตรหลังหย่า"],
};

let checked = 0;
for (const topic of TOPICS) {
  assert.ok(topic.patterns.length > 0, `${topic.key}: ไม่มี pattern เลย`);
  assert.ok(!topic.reviewed || topic.reviewed === true, `${topic.key}: ค่า reviewed ต้องเป็น boolean`);
  const samples = SAMPLES[topic.key];
  assert.ok(samples && samples.length, `${topic.key}: ไม่มีตัวอย่างข้อความทดสอบ (แก้ SAMPLES ในไฟล์นี้ด้วยเมื่อเพิ่มหมวดใหม่)`);
  for (const s of samples) {
    const found = matchTopic(s);
    assert.ok(found, `หมวด "${topic.key}" จับข้อความตัวอย่างไม่ได้: "${s}"`);
    assert.equal(found.key, topic.key, `ข้อความ "${s}" ควรจับเป็นหมวด "${topic.key}" แต่จับได้ "${found.key}"`);
    checked++;
  }
}

// คำเร่งด่วน
const urgentSamples = ["ถูกทำร้ายร่างกายตอนนี้", "เพิ่งโอนเงินให้มิจฉาชีพไปเมื่อกี้", "ฉุกเฉินมากช่วยด้วย"];
for (const s of urgentSamples) {
  assert.ok(matchUrgent(s), `ควรจับเป็นคำเร่งด่วน: "${s}"`);
  checked++;
}
const normalSamples = ["สอบถามเรื่องหย่าทั่วไป", "อยากรู้เรื่องมรดก"];
for (const s of normalSamples) {
  assert.ok(!matchUrgent(s), `ไม่ควรถูกจับเป็นคำเร่งด่วน (false positive): "${s}"`);
  checked++;
}

// เตือนหมวดที่ยังไม่ผ่านนิติกรตรวจ — ไม่ทำให้ test ล้ม แค่พิมพ์เตือนให้เห็นชัด
const unreviewed = UNREVIEWED_TOPICS();
if (unreviewed.length) {
  console.warn(`⚠️  ยังไม่ผ่านนิติกรตรวจ (${unreviewed.length}/${TOPICS.length}): ${unreviewed.join(", ")}`);
}

console.log(`✅ test-keywords.mjs ผ่านทั้งหมด (${checked} ข้อความทดสอบ)`);
