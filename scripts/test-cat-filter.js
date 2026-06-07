// Test rápido de la lógica de filtrado por categoría (Fase 4).
function _normCat(raw){if(raw==null)return '';return String(raw).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[\s_-]+/g,' ').trim();}
function _linkCategory(link){if(!link)return '';return link.category||link.categoryLabel||link.teamName||'';}
function _catMatches(coachCat,link){const cc=_normCat(coachCat);if(!cc)return true;if(link&&link.type==='staff')return true;const lc=_normCat(_linkCategory(link));if(!lc)return true;return lc===cc;}

let pass=0,fail=0;
function eq(name,a,b){if(a===b){pass++;}else{fail++;console.log('FAIL',name,'got',a,'expected',b);}}

// normalización
eq('norm tildes','alevin a',_normCat('Alevín A'));
eq('norm guiones','alevin a',_normCat('ALEVIN-A'));
eq('norm espacios','alevin a',_normCat('  alevín   a '));
eq('norm null','',_normCat(null));

// coincidencias
eq('coach sin cat ve todo',true,_catMatches('',{category:'Benjamín'}));
eq('staff siempre',true,_catMatches('Alevín A',{type:'staff'}));
eq('link sin cat legacy se muestra',true,_catMatches('Alevín A',{type:'parent'}));
eq('misma cat exacta',true,_catMatches('Alevín A',{type:'parent',category:'Alevín A'}));
eq('misma cat distinta forma',true,_catMatches('Alevín A',{type:'parent',category:'alevin-a'}));
eq('cat distinta oculta',false,_catMatches('Alevín A',{type:'parent',category:'Benjamín B'}));
eq('usa teamName fallback',true,_catMatches('Cadete','{}'&&{type:'parent',teamName:'Cadete'}));
eq('usa categoryLabel fallback',true,_catMatches('Infantil',{type:'parent',categoryLabel:'Infantil'}));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
