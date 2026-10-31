// Minimal stand-in for three.js used only by headless tools: rendering calls become no-ops,
// while the crowd model, sensors, fusion and rules run unchanged.
(function(){const h={get(t,k){if(k===Symbol.toPrimitive)return()=>0;if(k==='then')return undefined;if(k===Symbol.iterator)return function*(){};if(k==='length')return 0;if(!(k in t.c))t.c[k]=mk();return t.c[k];},set(t,k,v){t.c[k]=v;return true},apply(){return mk()},construct(){return mk()}};
function mk(){const f=function(){};f.c={};return new Proxy(f,h);}window.THREE=mk();})();
