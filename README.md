# Jungle Rooftop & Lounge 🌿✨
### Luxury Bilingual Digital Menu Showcase & Admin System (SQLite + Node.js + Vercel Ready)

تطبيق ويب فاخر وسريع لعرض قائمة الطعام والمشروبات والأسعار لمطعم ولاونج **"Jungle Rooftop & Lounge"**، متوافق مع كافة أحجام الشاشات ومع قاعدة بيانات **SQLite** مدمجة عالية الاعتمادية، ومجهز بالكامل للإطلاق على **Vercel** بنقرة واحدة.

---

## 🌟 الميزات الرئيسية (Features):

1. **عرض مخصص للأطباق والمشروبات (Pure Menu Showcase):**
   - قائمة طعام رقمية فاخرة وسريعة للزبائن.
   - عرض أسماء الوجبات، المكونات، الشارات، وحالة التوفر مع أسعار رقمية نقية بدون رموز عملات.
   - خيار التبديل بين عرض الشبكة (Grid) وعرض القائمة السريع (List).
   - صور الوجبات ترفع مباشرة من جهازك وتعمل بذكاء فائق.

2. **رفع الصور من جهازك مباشرة (Direct Device Upload):**
   - يدعم كافة صيغ الصور (`JPG`, `PNG`, `WEBP`, `SVG`, `GIF`, `AVIF`, `HEIC`...).
   - ضغط وتصغير تلقائي فائق السرعة داخل المتصفح قبل الرفع لضمان أعلى جودة بأقل حجم وتجاوز قيود Vercel.
   - إمكانية حذف الصور والشعار نهائياً بنقرة زر.

3. **لوحة تحكم إدارية متكاملة (`/admin`):**
   - الدخول حصرياً عبر الرابط المباشر `/admin`.
   - تعديل اسم المطعم وعنوانه وشعاره مباشرة.
   - إضافة وحذف وتعديل الوجبات والتصنيفات بحفظ فوري وتعديل نظيف.
   - **النسخ الاحتياطي والاستعادة (Backup & Restore):** إمكانية تحميل نسخة احتياطية كاملة بصيغة JSON واستعادتها في أي وقت بنقرة واحدة لضمان أمان البيانات 100%.

4. **جاهز للإطلاق على Vercel (Vercel Serverless Architecture):**
   - يحتوي على ملف `vercel.json` المضبوط لبيئة Serverless Functions.
   - نقطة دخول مخصصة `api/index.js` متوافقة مع Vercel.
   - تخزين محلي وذاكرة متزامنة (`localStorage`) لضمان بقاء البيانات حتى مع إعادة تشغيل دوال Serverless.

---

## 🚀 طريقة الرفع على Vercel (Deploy to Vercel):

### الطريقة الأولى: عبر GitHub و Vercel Dashboard (الأسهل والأفضل):
1. قم بإنشاء مستودع جديد على **GitHub** (مثلاً: `jungle-rooftop-menu`).
2. ارفع مجلد المشروع إلى المستودع:
   ```bash
   git init
   git add .
   git commit -m "Initial commit - Ready for Vercel"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
   git push -u origin main
   ```
3. ادخل إلى موقع [Vercel](https://vercel.com/) واضغط **"Add New Project"**.
4. اختر المستودع الخاص بك واضغط **Deploy**.
5. سيعمل موقعك فوراً مع رابط مجاني مثل `https://your-project.vercel.app`!

### الطريقة الثانية: عبر Vercel CLI مباشرة من الطرفية:
```bash
npm i -g vercel
vercel
```

---

## 💻 التشغيل محلياً على جهازك (Local Development):

```bash
npm install
npm start
```
ثم افتح الرابط:
👉 **`http://localhost:3000`**

لوحة الإدارة:
👉 **`http://localhost:3000/admin`**

---

## 🔐 بيانات تسجيل دخول الإدارة:
- **اسم المستخدم:** `admin`
- **كلمة المرور:** `123456`
