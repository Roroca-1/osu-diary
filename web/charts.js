/* SVG charts with explicit units, shared time coordinates and accessible details. */
(function () {
  'use strict';
  const I = window.DiaryI18n, t = I.t, NS = 'http://www.w3.org/2000/svg';
  const colors = { pp: '#ff77b5', best: '#ffd76e', acc: '#68d2ff', ar: '#ad8aff', bpm: '#68d2ff' };
  const valid = v => typeof v === 'number' && Number.isFinite(v);
  const n = (v, digits = 0) => v == null ? '—' : I.number(v, digits);
  const acc = v => v == null ? '—' : n(v, 2) + '%';
  const pp = v => v == null ? '—' : n(v) + 'pp';
  function node(tag, attrs = {}, text) {
    const el = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function accuracyDomain(values, full = false) {
    const good = values.filter(valid);
    return [full || !good.length ? 0 : Math.max(0, Math.min(95, Math.floor(Math.min(...good) / 5) * 5 - 5)), 100];
  }
  function nextDay(day) {
    const [y, m, d] = day.split('-').map(Number), date = new Date(y, m - 1, d + 1);
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  }
  function segments(days, key) {
    const out = []; let current = [], previous = null;
    for (const day of days) {
      if (!valid(day[key])) { if (current.length) out.push(current); current=[];previous=null;continue; }
      if (previous && nextDay(previous.d) !== day.d) { if (current.length) out.push(current); current=[]; }
      current.push(day); previous=day;
    }
    if (current.length) out.push(current);
    return out;
  }
  let tip;
  function hideTip() { if (tip) tip.hidden = true; }
  function showTip(text, event, target) {
    if (!tip) { tip=document.createElement('div');tip.id='chartTip';tip.role='tooltip';document.body.appendChild(tip); }
    tip.textContent=text;tip.hidden=false;
    const rect=target.getBoundingClientRect(), x=event?.clientX ?? rect.left+rect.width/2, y=event?.clientY ?? rect.top;
    tip.style.left=Math.max(8,Math.min(window.innerWidth-tip.offsetWidth-8,x+12))+'px';
    tip.style.top=Math.max(8,Math.min(window.innerHeight-tip.offsetHeight-8,y+12))+'px';
  }
  function interactive(mark, text, click, focus = true) {
    mark.append(node('title',{},text));
    if (focus) {mark.setAttribute('tabindex','0');mark.setAttribute('role',click?'button':'img');mark.setAttribute('aria-label',text);}
    mark.addEventListener('pointermove',e=>showTip(text,e,mark));
    mark.addEventListener('pointerleave',hideTip);
    mark.addEventListener('focus',()=>showTip(text,null,mark));mark.addEventListener('blur',hideTip);
    mark.addEventListener('click',e=>{showTip(text,e,mark);if(click)click();});
    if(click)mark.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();click();}});
    return mark;
  }
  function frame(id, title, {xMin,xMax,yMin,yMax,xLabel,yLabel,xFormat,yFormat,minWidth=0,integerY=false,xStep=0}) {
    const el=document.getElementById(id);el.replaceChildren();
    const W=Math.max(280,el.clientWidth||620,minWidth),H=260,p={l:54,r:20,t:26,b:54};
    const svg=node('svg',{viewBox:`0 0 ${W} ${H}`,role:'img','aria-label':t(title)});
    if(minWidth > (el.clientWidth||620)) {svg.style.width=W+'px';svg.style.maxWidth='none';el.classList.add('fine-detail');} else el.classList.remove('fine-detail');
    svg.append(node('title',{},t(title)));
    const x=v=>p.l+(W-p.l-p.r)*(v-xMin)/Math.max(0.00001,xMax-xMin), y=v=>p.t+(H-p.t-p.b)*(1-(v-yMin)/Math.max(0.00001,yMax-yMin));
    const ticks=W<450?3:5, ys=new Set();
    for(let i=0;i<=4;i++){
      let value=yMin+(yMax-yMin)*i/4;if(integerY)value=Math.round(value);if(ys.has(value))continue;ys.add(value);
      svg.append(node('line',{x1:p.l,x2:W-p.r,y1:y(value),y2:y(value),class:'chart-grid'}));
      svg.append(node('text',{x:p.l-8,y:y(value)+4,'text-anchor':'end',class:'chart-tick'},yFormat(value)));
    }
    const xValues = xStep ? Array.from({length:Math.floor((xMax-xMin)/xStep)+1},(_,i)=>xMin+i*xStep) : Array.from({length:ticks+1},(_,i)=>xMin+(xMax-xMin)*i/ticks);
    for(let i=0;i<xValues.length;i++){
      const value=xValues[i];
      svg.append(node('text',{x:x(value),y:H-30,'text-anchor':i===0?'start':i===ticks?'end':'middle',class:'chart-tick'},xFormat(value)));
    }
    svg.append(node('text',{x:p.l,y:13,class:'chart-axis-label'},yLabel));
    svg.append(node('text',{x:(p.l+W-p.r)/2,y:H-8,'text-anchor':'middle',class:'chart-axis-label'},xLabel));
    el.append(svg); return {el,svg,x,y,W,H,p};
  }
  function empty(id,accuracy=false) {document.getElementById(id).innerHTML='';const el=document.createElement('div');el.className='empty-hint';el.textContent=t(accuracy?'No accuracy data in this range':'No data in this range');document.getElementById(id).append(el);}
  function legend(id, entries, note) {
    const el=document.getElementById(id), box=document.createElement('div');box.className='chart-legend';
    for(const [label,color,dashed] of entries){const item=document.createElement('span'),swatch=document.createElement('i');swatch.style.borderColor=color;if(dashed)swatch.style.borderTopStyle='dashed';item.append(swatch,document.createTextNode(t(label)));box.append(item);}
    el.append(box);
    if(note){const text=document.createElement('div');text.className='chart-note';text.textContent=note;el.append(text);}
  }
  function sampleNote(meta) {return meta&&meta.shown<meta.total?t('Showing {shown} of {total} plays; aggregates use all scores.',meta):'';}
  function date(value,range,full=false){return I.date(value,full?{dateStyle:'medium',timeZone:range.timeZone}:{month:'short',day:'numeric',...(range.plotTo-range.plotFrom>365*86400000?{year:'2-digit'}:{}),timeZone:range.timeZone});}
  function playTip(p,range){return `${p.artist||''} - ${p.title||''}${p.version?' ['+p.version+']':''}\n`+t('Date: {date} · pp: {pp} · Accuracy: {acc} · BPM: {bpm}',{date:I.date(p.played_at,{dateStyle:'medium',timeStyle:'short',timeZone:range.timeZone}),pp:pp(p.pp),acc:acc(p.acc),bpm:n(p.bpm,1)});}
  function daily(f,s,key,color,dash){
    for(const group of segments(s.series,key)){
      if(group.length>1)f.svg.append(node('path',{d:group.map((p,i)=>`${i?'L':'M'}${f.x(p.t)},${f.y(p[key])}`).join(' '),fill:'none',stroke:color,'stroke-width':2,...(dash?{'stroke-dasharray':'5 4'}:{}),'data-series':key}));
      for(const d of group){const text=t('Average accuracy')+': '+acc(d.avgacc)+'\n'+t('Daily best')+': '+(key==='toppp'?pp(d.toppp):acc(d.topacc))+'\n'+date(d.t,s.range,true)+' · '+t('{count} plays',{count:d.n});
        const mark=node('circle',{cx:f.x(d.t),cy:f.y(d[key]),r:3.5,fill:color,'data-day':d.d,'data-value':d[key],'data-series':key});f.svg.append(interactive(mark,text));}
    }
  }
  function keyboardPlays(f, points, range, locate, onPlay) {
    let index = 0, highlight;
    const hint = t('Use left/right arrows to explore plays; Enter opens the beatmap.');
    f.svg.setAttribute('tabindex', '0'); f.svg.setAttribute('role', 'group');
    f.svg.setAttribute('aria-label', f.svg.getAttribute('aria-label') + '. ' + hint);
    const show = () => {
      const p = points[index], [cx, cy] = locate(p);
      if (!highlight) { highlight=node('circle',{r:5,fill:'none',stroke:'#fff','stroke-width':2,'pointer-events':'none'});f.svg.append(highlight); }
      highlight.setAttribute('cx',cx);highlight.setAttribute('cy',cy);highlight.hidden=false;
      showTip(playTip(p,range),null,highlight);
    };
    f.svg.addEventListener('focus',e=>{if(e.target===f.svg)show();});
    f.svg.addEventListener('blur',()=>{highlight?.remove();highlight=null;hideTip();});
    f.svg.addEventListener('keydown',e=>{
      if(e.target!==f.svg)return;
      if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();index=(index+(e.key==='ArrowRight'?1:-1)+points.length)%points.length;show();}
      if(e.key==='Enter'){e.preventDefault();onPlay(points[index]);}
      if(e.key==='Escape'){highlight?.remove();highlight=null;hideTip();}
    });
  }
  function ppChart(s,onPlay){
    if(!s.ppSeries.length){empty('chartPp');return;}
    const max=s.agg.maxPp||0, magnitude=10**Math.floor(Math.log10(Math.max(1,max))), ymax=Math.max(10,Math.ceil(max/(magnitude/2))*(magnitude/2));
    const f=frame('chartPp','pp per play',{xMin:s.range.plotFrom,xMax:s.range.plotTo,yMin:0,yMax:ymax,xLabel:t('Date'),yLabel:t('pp per play'),xFormat:v=>date(v,s.range),yFormat:v=>n(v)});
    for(const p of s.ppSeries){const c=node('circle',{cx:f.x(p.played_at),cy:f.y(p.pp),r:2.6,fill:colors.pp,opacity:0.6,'data-timestamp':p.played_at,'data-value':p.pp});f.svg.append(interactive(c,playTip(p,s.range),()=>onPlay(p),false));}
    keyboardPlays(f,s.ppSeries,s.range,p=>[f.x(p.played_at),f.y(p.pp)],onPlay);
    daily(f,s,'toppp',colors.best);legend('chartPp',[['Each play',colors.pp],['Daily best',colors.best]],sampleNote(s.points.pp));
  }
  function accuracyChart(s,full){
    const values=s.series.flatMap(d=>[d.avgacc,d.topacc]).filter(valid);if(!values.length){empty('chartAcc',true);return;}
    const [low,hi]=accuracyDomain(values,full),f=frame('chartAcc','Accuracy over time',{xMin:s.range.plotFrom,xMax:s.range.plotTo,yMin:low,yMax:hi,xLabel:t('Date'),yLabel:t('Accuracy')+` (%) · ${n(low)}–100`,xFormat:v=>date(v,s.range),yFormat:v=>n(v)+'%'});
    daily(f,s,'avgacc',colors.acc);daily(f,s,'topacc',colors.pp,true);legend('chartAcc',[['Daily average',colors.acc],['Daily best',colors.pp,true]]);
  }
  function tempoChart(s,onPlay){
    if(!s.stream.length){empty('chartStream');return;}
    const xs=s.stream.map(p=>p.bpm),ys=s.stream.map(p=>p.acc),xmin=Math.floor(Math.min(...xs)/10)*10,xmax=Math.max(xmin+10,Math.ceil(Math.max(...xs)/10)*10),[low,hi]=accuracyDomain(ys);
    const f=frame('chartStream','Tempo & Accuracy',{xMin:xmin,xMax:xmax,yMin:low,yMax:hi,xLabel:'BPM',yLabel:t('Accuracy')+` (%) · ${n(low)}–100`,xFormat:v=>n(v),yFormat:v=>n(v)+'%'});
    f.svg.append(node('line',{x1:f.x(xmin),x2:f.x(xmax),y1:f.y(95),y2:f.y(95),stroke:colors.best,'stroke-width':1.5,'stroke-dasharray':'5 4'}));
    for(const p of s.stream){const mark=node('circle',{cx:f.x(p.bpm),cy:f.y(p.acc),r:2.6,fill:colors.acc,opacity:0.65,'data-value':p.acc});f.svg.append(interactive(mark,playTip(p,s.range),()=>onPlay(p),false));}
    keyboardPlays(f,s.stream,s.range,p=>[f.x(p.bpm),f.y(p.acc)],onPlay);
    legend('chartStream',[['Each play',colors.acc],['95% reference',colors.best,true]],sampleNote(s.points.tempo));
  }
  function bucketChart(s,metric,mode,onBucket){
    const id=metric==='ar'?'chartAr':'chartBpm', buckets=s[metric+'Buckets'];
    if(!buckets.length){empty(id);return;}
    const shown=mode==='accuracy'?buckets.filter(b=>b.avgAcc!==null):buckets;
    if(!shown.length){empty(id,true);return;}
    const step=buckets[0].upper-buckets[0].lower,xmin=buckets[0].lower,xmax=buckets.at(-1).upper;
    const fine=metric==='ar'?step<0.5:step<10;
    const [low,hi]=mode==='accuracy'?accuracyDomain(shown.map(b=>b.avgAcc)):[0,Math.max(1,...shown.map(b=>b.count))];
    const f=frame(id,metric==='ar'?'AR profile':'BPM profile',{xMin:xmin,xMax:xmax,yMin:low,yMax:hi,xLabel:metric.toUpperCase(),yLabel:mode==='accuracy'?t('Average accuracy')+` (%) · ${n(low)}–100`:t('Plays'),xFormat:v=>n(v,metric==='ar'?1:0),yFormat:v=>mode==='accuracy'?n(v)+'%':n(v),minWidth:fine?Math.ceil((xmax-xmin)/step)*7+74:0,integerY:mode==='plays',xStep:step*Math.ceil((xmax-xmin)/(5*step))});
    const width=(f.x(xmin+step)-f.x(xmin))*0.75;
    for(const b of shown){
      const value=mode==='accuracy'?b.avgAcc:b.count;
      const attrs=mode==='accuracy'?{cx:f.x((b.lower+b.upper)/2),cy:f.y(value),r:5}:{x:f.x(b.lower)+width/6,y:f.y(value),width:Math.max(1,width),height:f.y(0)-f.y(value),rx:2};
      const mark=node(mode==='accuracy'?'circle':'rect',{...attrs,fill:colors[metric],class:'bucket-mark','data-lower':b.lower,'data-upper':b.upper,'data-count':b.count,'data-value':value});
      const text=t('{metric} {lower}–<{upper} · {count} plays · Average {acc} (n={samples}) · Best {pp}',{metric:metric.toUpperCase(),lower:n(b.lower,metric==='ar'?1:0),upper:n(b.upper,metric==='ar'?1:0),count:b.count,acc:acc(b.avgAcc),samples:b.accCount,pp:pp(b.bestPp)});
      f.svg.append(interactive(mark,text,()=>onBucket(metric,b)));
      if(mode==='plays'&&width>=22)f.svg.append(node('text',{x:f.x((b.lower+b.upper)/2),y:f.y(value)-6,'text-anchor':'middle',class:'chart-tick'},n(b.count)));
    }
    legend(id,[[mode==='accuracy'?'Average accuracy':'Plays',colors[metric]]],fine?t('Fine detail: scroll horizontally.'):'');
  }
  window.DiaryCharts={render(s,opts){hideTip();ppChart(s,opts.onPlay);accuracyChart(s,opts.fullAccuracy);tempoChart(s,opts.onPlay);bucketChart(s,'ar',opts.arMode,opts.onBucket);bucketChart(s,'bpm',opts.bpmMode,opts.onBucket);},hideTip,accuracyDomain,segments,nextDay};
})();
