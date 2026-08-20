# Adsterra Publisher API findings

المصدر الرسمي: https://adsterra.com/blog/how-to-use-adsterra-publishers-api/
المصدر الرسمي العام: https://adsterra.com/api/
التوثيق الرسمي: https://docs.adsterratools.com/public/v3/publishers-api/

بحسب توثيق Adsterra، عنوان Publisher API الأساسي هو `https://api3.adsterratools.com/publisher`. المصادقة تكون عبر ترويسة `X-API-Key`، وطلبات الناشر تستخدم GET. الصيغ المدعومة JSON وXML وCSV، وJSON هو الافتراضي.

يمكن طلب تقرير الإحصائيات من `stats.json`، مع معاملات مثل `domain`, `placement`, `start_date`, `finish_date`, `group_by`, و`country`. التقرير يتضمن impressions وclicks وCTR وCPM وrevenue حسب التاريخ أو التجميع المطلوب. لعرض الأرباح الإجمالية يجب جمع قيم revenue من الصفوف التي يعيدها التقرير للفترة المحددة، مع عدم جمع الإجمالي إذا كانت الاستجابة تعيده مسبقًا لتجنب التكرار.

الأخطاء الموثقة: 401 يعني أن المفتاح غير صحيح، 403 يعني أن المفتاح لم يعد صالحًا، 404 لمسار غير صحيح، 405 لطريقة غير مسموحة، و422 لمعلمات غير قابلة للتفسير.

المفتاح يجب أن يبقى خادميًا في متغير بيئة مثل `ADSTERRA_API_KEY` وألا يرسل إلى المتصفح أو يسجل في السجلات. مفتاح المستخدم أُرسل في المحادثة وسيُستخدم فقط لإعداد السر الخادمي في بيئة النشر بعد التحقق من endpoint.
