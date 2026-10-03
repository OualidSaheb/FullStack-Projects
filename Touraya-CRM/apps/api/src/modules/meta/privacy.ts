/**
 * Public privacy policy page (Meta asks for one before an app goes Live, and for
 * a "data deletion" address). Plain HTML, no login, served by the API itself.
 */
export function privacyPage(owner: string) {
  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>سياسة الخصوصية — ${owner}</title>
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem;line-height:1.8;color:#1f2937}h1{font-size:1.5rem}h2{font-size:1.1rem;margin-top:1.5rem}</style>
</head><body>
<h1>سياسة الخصوصية — ${owner}</h1>
<p>هذه المنصة تستعمل لمعالجة طلبيات زبائن ${owner} القادمة من نماذج إعلانات Facebook و Instagram.</p>
<h2>البيانات التي نجمعها</h2>
<p>الاسم، رقم الهاتف، الولاية والبلدية والعنوان، والمنتج والمقاس واللون المطلوب — فقط ما يكتبه الزبون في نموذج الطلب.</p>
<h2>الاستعمال</h2>
<p>الاتصال بالزبون لتأكيد طلبيته، وإرسالها إلى شركة التوصيل. لا نبيع البيانات ولا نشاركها مع أي طرف آخر غير شركة التوصيل.</p>
<h2>الحفظ والحذف</h2>
<p>تُحفظ البيانات في قاعدة بيانات محمية ولا يصل إليها إلا موظفو ${owner}. لطلب حذف بياناتك، راسل صفحتنا على Facebook برقم هاتفك، وتُحذف خلال 30 يوماً.</p>
<h1 lang="fr" dir="ltr" style="margin-top:2.5rem">Politique de confidentialité</h1>
<p lang="fr" dir="ltr">Les données saisies dans nos formulaires (nom, téléphone, wilaya, commune, adresse, produit) servent uniquement à confirmer et livrer votre commande. Elles ne sont ni vendues ni partagées, sauf avec la société de livraison. Pour supprimer vos données, écrivez à notre page Facebook avec votre numéro : suppression sous 30 jours.</p>
</body></html>`;
}
