sap.ui.define([
    "sap/fe/test/JourneyRunner",
	"com/jhah/zhrjhahsecid/test/integration/pages/headerList.gen",
	"com/jhah/zhrjhahsecid/test/integration/pages/headerObjectPage.gen",
	"com/jhah/zhrjhahsecid/test/integration/pages/appAreaObjectPage.gen"
], function (JourneyRunner, headerListGenerated, headerObjectPageGenerated, appAreaObjectPageGenerated) {
    'use strict';

    const runner = new JourneyRunner({
        launchUrl: sap.ui.require.toUrl('com/jhah/zhrjhahsecid') + '/test/flp.html#app-preview',
        pages: {
			onTheheaderListGenerated: headerListGenerated,
			onTheheaderObjectPageGenerated: headerObjectPageGenerated,
			onTheappAreaObjectPageGenerated: appAreaObjectPageGenerated
        },
        async: true
    });

    return runner;
});

