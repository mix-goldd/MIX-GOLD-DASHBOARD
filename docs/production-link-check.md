# Production link check

- Checked URL: https://dooddash-8yxbqspj.manus.space/dashboard/statistics
- Repeated HTTPS checks from the sandbox failed 5/5 before restart and 3/3 after restart with OpenSSL error `wrong version number`; no HTTP response was received.
- HTTP on the same hostname returned a 307 redirect to an external IP landing page, so it is not a valid application response.
- Internal preview URL checked: https://3000-i2dyh5gn98xiekba10ad0-bfe304a8.sg1.manus.computer/dashboard/statistics
- Internal preview loaded the authenticated statistics page successfully and displayed `انقطع اتصال البث مؤقتًا — جاري إعادة الاتصال ومزامنة الأرقام تلقائيًا…`, with current statistics (153 total visits, 0 unique visitors in the selected range) and the dashboard navigation.
- Conclusion: the application route and statistics page render on the preview service; the public hostname is not stable from the current network path and must not be claimed as verified until the published edge/TLS endpoint returns a stable HTTPS response.

## Additional verification

The independent web extraction service and a fresh browser navigation both reached the public hostname over HTTPS and returned the application login page. This confirms that the deployed hostname is serving the application from those paths. The earlier `wrong version number` result is specific to the sandbox terminal/network route and is not sufficient evidence that the public site is down. The protected statistics page still requires a valid dashboard session before its live data can be checked on the public hostname.
