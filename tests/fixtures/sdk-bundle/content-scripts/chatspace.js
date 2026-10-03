// Fixture: the isolated content script after composition/tab.ts imported composition/background.ts (which imports @cg/hub).
(function(){function Cs(){return!0}
var qy=class extends Error{category;status;code;body;constructor(e,t,n,r,i){super(e),this.category=t,this.status=n,this.code=r,this.body=i,this.name=`KernelApiError`}};function Jy(e){return e instanceof qy}function Xy(e){return Jy(e)?`hub`:String(e)}
Cs()&&Xy(`extension-gone`)})();
