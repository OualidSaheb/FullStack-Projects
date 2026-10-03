# ربط Facebook Lead Ads مباشرة بالمنصة

النتيجة: كل طلبية تصل خلال ثوانٍ، بكل الإجابات (حتى الألوان المتعددة)، بدون Google Sheets. مجاني.
مدة الإعداد: حوالي 20–30 دقيقة، مرة واحدة فقط. تحتاج حساب Facebook المسؤول عن الصفحة وعن الـ Business.

> رابط المنصة في الأمثلة: `https://touraya-crm.onrender.com` — ضع رابطك إن كان مختلفاً. يجب أن يكون `PUBLIC_URL` في Render هو نفس الرابط.

---

## أ. إنشاء التطبيق (Meta for Developers)

1. افتح **https://developers.facebook.com/apps** ← **Create App**.
2. اختر **Other** ← نوع التطبيق **Business** ← Next.
3. الاسم: `Touraya CRM`، بريدك، و**Business portfolio**: اختر الـ Business الذي يملك الصفحة ← Create app.
4. في لوحة التطبيق: **App settings ← Basic**:
   - انسخ **App ID** و **App Secret** (زر Show) واحتفظ بهما.
   - **Privacy Policy URL**: `https://touraya-crm.onrender.com/privacy`
   - **User data deletion** ← Data deletion instructions URL: نفس الرابط.
   - **Category**: Business and pages ← **Save changes**.
5. في القائمة: **Add product** ← **Webhooks** ← Set up. (لا تكتب شيئاً فيه — المنصة تسجل عنوانها وحدها.)

## ب. مستخدم النظام (System User) والـ Token الدائم

في **https://business.facebook.com/settings**:

1. **Users ← System users ← Add**: الاسم `Touraya CRM`، الدور **Admin** ← Create.
2. اختره ← **Assign assets** (إضافة أصول):
   - **Pages** ← صفحتك ← **Full control**.
   - **Apps** ← `Touraya CRM` ← **Full control**.
   - **Ad accounts** ← حساب الإعلانات ← **View performance** (لأسماء الإعلانات في الإحصائيات).
3. **Generate new token**:
   - App: `Touraya CRM`، **Token expiration: Never**.
   - الصلاحيات: `leads_retrieval`، `pages_show_list`، `pages_read_engagement`، `pages_manage_metadata`، `pages_manage_ads`، `ads_read`، `business_management`.
   - **Generate** ← انسخ الـ Token فوراً (لا يظهر مرة ثانية). لا تشاركه مع أحد.

## ج. السماح للتطبيق بقراءة الطلبيات

في نفس الإعدادات: **Integrations ← Leads Access** ← اختر صفحتك ← تبويب **CRMs** ← **Assign CRMs** ← `Touraya CRM` ← Assign.

## د. تشغيل التطبيق (Live)

في لوحة التطبيق (developers.facebook.com) أعلى الصفحة: **App Mode: Development ← Live** (أو **Publish**).
إذا طلب Meta شيئاً ناقصاً (أيقونة، تصنيف، التحقق من النشاط التجاري) يظهر لك في نفس المكان — أكمله ثم أعد المحاولة.

## هـ. الربط في المنصة

1. المنصة ← **الإدارة ← استقبال الطلبيات والفورمات** ← بطاقة **«Facebook — ربط مباشر»**.
2. الصق **App ID** و **App Secret** و **Token الـ System User** ← **التحقق وعرض الصفحات**.
3. اختر الصفحة ← **ربط الصفحة**. تجلب المنصة طلبيات آخر 3 أيام (بدون تكرار) وتبقى تستقبل الجديدة.

## و. التجربة

1. افتح **https://developers.facebook.com/tools/lead-ads-testing**.
2. اختر الصفحة والفورم ← **Create lead** (إن كانت هناك طلبية تجريبية سابقة: **Delete lead** أولاً).
3. خلال ثوانٍ تظهر الطلبية في المنصة مع الصوت والإشعار. احذفها بعد ذلك.

---

## أسئلة سريعة

- **هل أبقي مجلد Drive؟** نعم في البداية، كاحتياط: نفس الطلبية لا تتكرر أبداً (نفس Lead ID). بعد أسبوع بدون مشاكل يمكنك التوقف عن ربط الشيتات.
- **أسماء الفورمات**: نفس القاعدة — اسم الفورم يبدأ باسم العرض فيُربط تلقائياً.
- **الألوان المتعددة**: مع الربط المباشر، سؤال «اختاري الألوان» متعدد الاختيارات يصل كاملاً.
- **إذا نامت المنصة** (استضافة مجانية): المنصة تراجع كل الفورمات كل 10 دقائق، فلا تضيع طلبية.

## إذا ظهر خطأ في البطاقة

| الرسالة | الحل |
|---|---|
| Token غير صالح أو انتهت صلاحيته | أنشئ Token جديداً (الخطوة ب-3) مع **Never** |
| صلاحية ناقصة | أعد إنشاء الـ Token مع كل الصلاحيات المذكورة، وتأكد أن الصفحة مضافة للـ System User |
| لا يملك أي صفحة | الخطوة ب-2: أضف الصفحة للـ System User |
| Leads Access | الخطوة ج |
| verify / callback | تأكد أن `PUBLIC_URL` في Render هو رابط المنصة الصحيح، وأن المنصة مستيقظة، ثم أعد الربط |
