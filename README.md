# Jungle Rooftop & Lounge 🌿✨
### Luxury Bilingual Digital Menu Showcase & Admin System (TiDB Cloud + Vercel Serverless + Vercel Blob)

تطبيق ويب فاخر وسريع لعرض قائمة الطعام والمشروبات والأسعار لمطعم ولاونج **"Jungle Rooftop & Lounge"**، متوافق مع كافة أحجام الشاشات ومتصل بقاعدة بيانات سحابية دائمة ومستقرة **TiDB Cloud (Serverless MySQL)**، مع تخزين سحابي فائق السرعة للصور عبر **Vercel Blob**، ومجهز للعمل الدائم على **Vercel**.

---

## 🌟 الميزات المعمارية الرئيسية (Architecture & Features):

1. **قاعدة بيانات سحابية دائمة (TiDB Cloud Serverless):**
   - اتصال عبر مكتبة `@tidbcloud/serverless` الرسمية (مبنية على بروتوكول HTTPS المشفر بدلاً من اتصالات TCP المعرضة للقطع).
   - لا تتأثر بحدود الـ Max Connections أو انقطاع اتصالات دوال Vercel Serverless.
   - حفظ فوري ومباشر لجميع التغييرات (Insert / Update / Delete).
   - **الحذف النهائي:** عند حذف أي وجبة أو تصنيف من لوحة الإدارة يتم حذفه نهائياً وفورياً من TiDB Cloud.
   - **التحديث المباشر:** عند تعديل أي وجبة أو تصنيف يتم تحديث البيانات القديمة فوراً بالقيمة الجديدة.

2. **تخزين الصور خارج قاعدة البيانات (Cloud CDN Storage):**
   - لا يتم تخزين الصور داخل قاعدة البيانات (مما يحافظ على قاعدة البيانات خفيفة ومجانية مدى الحياة وسريعة جداً).
   - يتم رفع الصور تلقائياً إلى **Vercel Blob** كـ CDN عام عالي الأداء مع روابط دائمة وسريعة.
   - عند حذف وجبة أو تغيير صورتها، يتم تنظيف وحذف ملف الصورة القديم تلقائياً.

3. **لوحة تحكم إدارية متكاملة (`/admin`):**
   - الدخول المباشر عبر الرابط `/admin`.
   - تعديل هوية المطعم، الشعار، صورة الغلاف، وروابط التواصل.
   - إضافة وتعديل وحذف الأطباق والتصنيفات وتحديث حالة التوفر (In Stock / Sold Out).
   - **النسخ الاحتياطي والاستعادة (Backup & Restore):** تصدير واستيراد ملفات JSON لقاعدة البيانات بنقرة واحدة.

4. **تحديث فوري لجميع الأجهزة بدون إعادة تحميل الصفحة (Live Sync):**
   - مزامنة حية لكافة شاشات الزبائن وأجهزة الصالة فور قيام الإدارة بأي تعديل عبر استعلام دوري خفيف لنسخة المنيو (`/api/menu-version`).

---

## ⚙️ متغيرات البيئة (Environment Variables):

| المتغير | الوصف | القيمة الافتراضية |
| :--- | :--- | :--- |
| `DATABASE_URL` | رابط الاتصال بقاعدة بيانات TiDB Cloud | `mysql://BKwcRjQd2jpMwgD.root:3lrHd8U3fjrgrmGr@gateway01.ap-northeast-1.prod.aws.tidbcloud.com:4000/jungle_menu` |
| `BLOB_READ_WRITE_TOKEN` | توكن رفع الصور على Vercel Blob | من لوحة تحكم Vercel Blob |

> **ملاحظة:** الكود مضبوط تلقائياً للاتصال بقاعدة بيانات `jungle_menu` على TiDB Cloud بشكل مباشر وافتراضي حتى بدون إعداد متغير بيئة، مع إمكانية تمريره عبر Vercel Environment Variables.

---

## 🚀 النشر على Vercel (Deployment):

المشروع مربوط بمستودع GitHub:
`https://github.com/Rami19994/jungil.git`

عند رفعه على Vercel:
1. استورد المستودع في Vercel.
2. أضف متغير البيئة `BLOB_READ_WRITE_TOKEN` في Vercel Settings -> Environment Variables.
3. اضغط **Deploy**.

---

## 💻 التشغيل محلياً (Local Development):

```bash
npm install
npm start
```
- المنيو للزبائن: `http://localhost:3000`
- لوحة الإدارة: `http://localhost:3000/admin`
- فحص الحالة: `http://localhost:3000/api/health`

---

## 🔐 بيانات دخول لوحة الإدارة:
- **اسم المستخدم:** `admin`
- **كلمة المرور:** `123456`
