import{p as D,m as M,at as _,aq as N,au as F,S as H,av as B,aw as O,ax as U}from"./index-a9aUAX74.js";import"./pixi-CaEdeioT.js";function Y(i){const t=String(i??"");return t==="PHYS_MELEE"?"MELEE":t==="PHYS_RANGED"?"RANGED":t==="SIEGE"?"SIEGE":t==="ELEMENTAL_FIRE"?"FIRE":t==="DIVINE"?"DIVINE":t.replace(/_/g," ")}function G(i){if(!i)return"";if(i.description)return i.description;const t=[];return i.global?.description&&t.push(`Global: ${i.global.description}`),i.local?.description&&t.push(`Local: ${i.local.description}`),t.join(" ")}function K(i){if(document.getElementById("choose-hero-modal"))return;j(),D("choose-hero-bgm",M("assets/sfx/smash_bros_choose.mp3"),{loop:!1,gain:.55});const t=document.createElement("div");t.id="choose-hero-modal",t.style.cssText=`
    position: fixed; inset: 0;
    display: flex; align-items: flex-start; justify-content: center;
    padding: clamp(16px, 3vh, 36px) clamp(8px, 2vw, 24px);
    box-sizing: border-box;
    overflow: auto;
    background: radial-gradient(ellipse at center, rgba(20,8,8,0.92) 0%, rgba(0,0,0,0.97) 80%);
    z-index: 9999;
    font-family: 'Courier New', monospace;
    color: #e8d6a8;
    animation: chmFadeIn 0.32s ease-out;
    backdrop-filter: blur(2px);
  `;let T=null;try{T=localStorage.getItem("roman_td_last_hero_id")}catch{}const u=_(),a=document.createElement("div");a.style.cssText=`
    position: relative;
    width: min(1180px, 96vw);
    max-height: calc(100% - 24px);
    overflow: auto;
    padding: clamp(20px, 3vh, 40px) clamp(20px, 3vw, 40px);
    text-align: center;
  `,a.innerHTML=`
    <div style="font-size: clamp(11px, 1.4vh, 14px); color: #aa6a1a; letter-spacing: 6px; font-weight: 900; margin-bottom: 6px; text-shadow: 1px 1px 0 #000;">ROME CALLS A CHAMPION</div>
    <div style="font-size: clamp(28px, 5vh, 52px); color: #ffd34d; letter-spacing: clamp(4px, 0.8vw, 12px); font-weight: 900; line-height: 1.05; margin-bottom: 6px; text-shadow: 0 0 18px #ffd34d, 4px 4px 0 #1a0808;">CHOOSE YOUR HERO</div>
    <div style="font-size: clamp(11px, 1.4vh, 14px); color: #cdb98a; letter-spacing: 2px; margin-bottom: 4px; font-style: italic;">Six champions stand ready. Scroll the line and answer the legion's call.</div>
    <div class="chm-kbd-hint" style="font-size: 10px; color: #88735a; letter-spacing: 3px; margin-bottom: clamp(18px, 3vh, 32px);">
      <span style="display:inline-block; padding:1px 6px; border:1px solid #5a4a30; margin:0 2px; background:#1a0e08;">1</span>
      <span style="display:inline-block; padding:1px 6px; border:1px solid #5a4a30; margin:0 2px; background:#1a0e08;">2</span>
      <span style="display:inline-block; padding:1px 6px; border:1px solid #5a4a30; margin:0 2px; background:#1a0e08;">3</span>
      <span style="display:inline-block; padding:1px 6px; border:1px solid #5a4a30; margin:0 2px; background:#1a0e08;">4</span>
      <span style="display:inline-block; padding:1px 6px; border:1px solid #5a4a30; margin:0 2px; background:#1a0e08;">5</span>
      <span style="display:inline-block; padding:1px 6px; border:1px solid #5a4a30; margin:0 2px; background:#1a0e08;">6</span>
      keys to focus
      <span style="display:inline-block; padding:1px 6px; border:1px solid #5a4a30; margin:0 0 0 8px; background:#1a0e08;">ENTER</span>
      to march · or click · scroll →
    </div>
  `;const d=document.createElement("div");d.style.cssText=`
    position: relative;
    margin-bottom: clamp(18px, 3vh, 32px);
  `;const m=document.createElement("div");m.style.cssText=`
    display: flex;
    gap: clamp(12px, 2vw, 18px);
    overflow-x: auto;
    overflow-y: hidden;
    padding: 4px 4px 12px 4px;
    scroll-snap-type: x mandatory;
    -webkit-overflow-scrolling: touch;
    scroll-behavior: smooth;
  `;const I=`
    position: absolute;
    top: 0;
    bottom: 12px;
    width: 64px;
    pointer-events: none;
    transition: opacity 0.25s ease-out;
    z-index: 2;
  `,o=document.createElement("div");o.style.cssText=I+`
    left: 0;
    background: linear-gradient(to right, rgba(20, 10, 6, 0.92) 0%, rgba(20, 10, 6, 0) 100%);
    opacity: 0;
  `;const v=document.createElement("div");v.style.cssText=I+`
    right: 0;
    background: linear-gradient(to left, rgba(20, 10, 6, 0.92) 0%, rgba(20, 10, 6, 0) 100%);
    opacity: 1;
  `;const z=`
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 52px;
    height: 52px;
    border-radius: 50%;
    border: 2px solid #ffd34d;
    background: linear-gradient(180deg, #4a2a0a, #2a1408);
    color: #ffd34d;
    font-family: 'Courier New', monospace;
    font-size: 30px;
    font-weight: 900;
    line-height: 1;
    cursor: pointer;
    z-index: 3;
    box-shadow: 0 0 16px rgba(255, 211, 77, 0.55), 0 0 32px rgba(255, 211, 77, 0.25);
    transition: opacity 0.25s ease-out, transform 0.18s cubic-bezier(.2,.8,.2,1), box-shadow 0.22s ease-out;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 0 3px 0;
    user-select: none;
    animation: chmChevPulse 1.8s ease-in-out infinite;
  `,p=document.createElement("button");p.type="button",p.setAttribute("aria-label","Scroll heroes left"),p.textContent="‹",p.style.cssText=z+`
    left: -22px;
    opacity: 0;
    pointer-events: none;
  `;const l=document.createElement("button");l.type="button",l.setAttribute("aria-label","Scroll heroes right"),l.textContent="›",l.style.cssText=z+`
    right: -22px;
    opacity: 1;
    animation-delay: 0.9s;
  `;const g=e=>{e.style.transform="translateY(-50%) scale(1.08)",e.style.boxShadow="0 0 28px rgba(255, 211, 77, 0.95), 0 0 56px rgba(255, 211, 77, 0.45)"},w=e=>{e.style.transform="translateY(-50%)",e.style.boxShadow="0 0 16px rgba(255, 211, 77, 0.55), 0 0 32px rgba(255, 211, 77, 0.25)"};p.onmouseenter=()=>g(p),p.onmouseleave=()=>w(p),l.onmouseenter=()=>g(l),l.onmouseleave=()=>w(l);const E=e=>{m.scrollBy({left:e*336,top:0,behavior:"smooth"})};if(p.onclick=()=>E(-1),l.onclick=()=>E(1),!document.getElementById("chm-chev-pulse-style")){const e=document.createElement("style");e.id="chm-chev-pulse-style",e.textContent=`
      @keyframes chmChevPulse {
        0%, 100% { box-shadow: 0 0 16px rgba(255, 211, 77, 0.55), 0 0 32px rgba(255, 211, 77, 0.25); }
        50%      { box-shadow: 0 0 28px rgba(255, 211, 77, 0.95), 0 0 56px rgba(255, 211, 77, 0.55); }
      }
    `,document.head.appendChild(e)}const h=document.createElement("div");h.id="choose-hero-confirm-strip",h.style.cssText=`
    margin-top: clamp(12px, 2vh, 24px);
    padding: clamp(14px, 2vh, 22px) clamp(20px, 3vw, 32px);
    border-top: 2px dashed #5a4a30;
    text-align: center;
    display: none;
  `;let b=null;const y=[],S=e=>{const n=u[e],r=F[n];b!==n&&(H.prospectKeep(),B("light")),b=n;for(let c=0;c<y.length;c++){const k=c===e;y[c].style.opacity=k?"1":"0.5",y[c].style.transform=k?"scale(1.04)":"scale(0.95)",y[c].style.boxShadow=k?`0 0 30px ${r.visual?.particleColor??"#ffd34d"}, 0 0 64px ${r.visual?.particleColor??"#ffd34d"}44, inset 0 0 24px ${r.visual?.particleColor??"#ffd34d"}22`:"0 0 8px rgba(0,0,0,0.6)",y[c].style.borderColor=k?r.visual?.tierUpColor??"#ffd34d":"#5a4a30"}h.innerHTML=`
      <div style="font-size: clamp(20px, 2.4vh, 28px); color: ${r.visual?.tierUpColor??"#ffd34d"}; letter-spacing: 4px; font-weight: 900; margin-bottom: 4px; text-shadow: 0 0 12px ${r.visual?.tierUpColor??"#ffd34d"};">${r.name?.toUpperCase()}</div>
      <div style="font-size: clamp(11px, 1.3vh, 13px); color: #cdb98a; letter-spacing: 2px; margin-bottom: clamp(14px, 2.2vh, 22px);">${r.title??""}</div>
      <button id="choose-hero-march" type="button" style="
        padding: clamp(10px, 1.6vh, 16px) clamp(28px, 4vw, 56px);
        background: linear-gradient(180deg, #5a3a16, #2a1a08);
        border: 3px solid #ffd34d;
        color: #ffd34d;
        font-family: 'Courier New', monospace;
        font-size: clamp(13px, 1.6vh, 16px);
        letter-spacing: 4px;
        font-weight: 900;
        cursor: pointer;
        box-shadow: 0 0 18px rgba(255,211,77,0.4);
        transition: transform 0.18s cubic-bezier(.2,.8,.2,1), box-shadow 0.22s ease-out;
        text-shadow: 2px 2px 0 #000;
      ">⚔ MARCH TO WAR</button>
    `,h.style.display="block";const s=h.querySelector("#choose-hero-march");s.onmouseenter=()=>{s.style.transform="translateY(-2px) scale(1.02)",s.style.boxShadow="0 0 36px rgba(255,211,77,0.9)"},s.onmouseleave=()=>{s.style.transform="",s.style.boxShadow="0 0 18px rgba(255,211,77,0.4)"},s.onclick=()=>{b&&(H.waveStartBlast(),B("success"),O(i,b),L())},setTimeout(()=>h.scrollIntoView({behavior:"smooth",block:"nearest"}),60)};for(let e=0;e<u.length;e++){const n=u[e],r=F[n],s=V(n,r,T===n,e+1),c=e;s.addEventListener("click",()=>S(c)),y.push(s),m.appendChild(s)}d.appendChild(m),d.appendChild(o),d.appendChild(v),d.appendChild(p),d.appendChild(l);const $=()=>{const e=m.scrollWidth-m.clientWidth,n=m.scrollLeft<=8,r=m.scrollLeft>=e-8;p.style.opacity=n?"0":"1",p.style.pointerEvents=n?"none":"auto",l.style.opacity=r?"0":"1",l.style.pointerEvents=r?"none":"auto",o.style.opacity=n?"0":"1",v.style.opacity=r?"0":"1",e<=4&&(p.style.opacity="0",l.style.opacity="0",o.style.opacity="0",v.style.opacity="0")};m.addEventListener("scroll",$,{passive:!0}),requestAnimationFrame($),window.addEventListener("resize",$),a.appendChild(d),a.appendChild(h),t.appendChild(a),document.body.appendChild(t);const f=e=>{if(e.key>="1"&&e.key<="6"){const n=parseInt(e.key,10)-1;n>=0&&n<u.length&&(S(n),y[n]?.scrollIntoView({behavior:"smooth",inline:"center",block:"nearest"}),e.preventDefault())}else e.key==="Enter"&&b&&(H.waveStartBlast(),B("success"),O(i,b),L(),e.preventDefault())};function L(){window.removeEventListener("keydown",f),window.removeEventListener("resize",$),U("choose-hero-bgm"),t.style.animation="chmFadeOut 0.22s ease-in forwards",setTimeout(()=>t.remove(),220)}window.addEventListener("keydown",f)}function j(){if(document.getElementById("choose-hero-modal-style"))return;const i=document.createElement("style");i.id="choose-hero-modal-style",i.textContent=`
    @keyframes chmFadeIn  { from { opacity: 0;   } to { opacity: 1; } }
    @keyframes chmFadeOut { from { opacity: 1;   } to { opacity: 0; } }
    @keyframes chmPulse   { 0%,100% { opacity:0.55; } 50% { opacity:1; } }
    .chm-kbd-hint { animation: chmPulse 2.4s ease-in-out infinite; }
    #choose-hero-modal [data-hero-card] {
      transition: transform 0.22s cubic-bezier(.2,.8,.2,1),
                  border-color 0.22s ease-out,
                  box-shadow 0.28s ease-out,
                  opacity 0.22s ease-out;
    }
    #choose-hero-modal [data-hero-card]:focus { outline: none; }
  `,document.head.appendChild(i)}function V(i,t,T,u){const a=t.visual?.tierUpColor??"#ffd34d",d=t.visual?.particleColor??a,I=`assets/heroes/hero_card_${i.replace(/^HERO_/,"").toLowerCase()}.png`,o=document.createElement("div");o.dataset.heroId=i,o.dataset.heroCard="1",o.style.cssText=`
    position: relative;
    flex: 0 0 320px;
    width: 320px;
    scroll-snap-align: start;
    background: linear-gradient(180deg, rgba(34,25,18,0.96), rgba(10,6,4,0.96));
    border: 3px solid #5a4a30;
    padding: 0;
    cursor: pointer;
    text-align: left;
    overflow: hidden;
  `,o.onmouseenter=()=>{o.style.opacity&&parseFloat(o.style.opacity)<.9||(o.style.borderColor=a,o.style.transform=o.style.transform.includes("scale(1.04)")?o.style.transform:"scale(1.02)",o.style.boxShadow=`0 0 24px ${d}66, inset 0 0 16px ${d}22`)},o.onmouseleave=()=>{o.style.transform.includes("scale(1.04)")||(o.style.borderColor="#5a4a30",o.style.transform="scale(1)",o.style.boxShadow="none")};const v=`
    <div style="position: absolute; top: 10px; left: 10px; min-width: 22px; height: 22px; padding: 0 6px;
                background: #1a0e08; border: 2px solid ${a}; color: ${a};
                display: flex; align-items: center; justify-content: center;
                font-size: 12px; letter-spacing: 1px; font-weight: 900;
                box-shadow: 0 0 10px ${d}66;
                text-shadow: 0 0 6px ${a};">${u}</div>
  `,z=T?`
    <div style="position: absolute; top: 10px; right: 10px; background: #1a0a1a; color: #ffd34d; border: 1px solid #ffd34d; padding: 3px 8px; font-size: 9px; letter-spacing: 2px; font-weight: 900; text-shadow: 1px 1px 0 #000;">★ LAST PICK</div>
  `:"",l=`
    <div style="position: relative; width: 100%; aspect-ratio: 3 / 4; background: ${`radial-gradient(circle at center, ${d}55 0%, ${d}11 50%, transparent 70%)`}; overflow: hidden;">
      <img src="${I}"
           alt="${(t.name??i).toUpperCase()}"
           style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; image-rendering: pixelated; image-rendering: crisp-edges;"
           onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
      <div style="display: none; position: absolute; inset: 0; flex-direction: column; align-items: center; justify-content: center; padding: 28px 16px; text-align: center;">
        <div style="font-size: clamp(48px, 7vw, 72px); color: ${a}; text-shadow: 0 0 18px ${a};">⚔</div>
        <div style="font-size: clamp(16px, 2.0vh, 20px); color: ${a}; letter-spacing: 3px; font-weight: 900; margin-top: 8px; text-shadow: 0 0 8px ${a}88, 2px 2px 0 #000;">${t.name?.toUpperCase()}</div>
        <div style="font-size: clamp(10px, 1.2vh, 12px); color: #cdb98a; letter-spacing: 2px; margin-top: 4px;">${t.title??""}</div>
        <div style="margin-top: 10px;">
          <span style="display: inline-block; padding: 3px 10px; background: ${a}22; border: 1px solid ${a}; color: ${a}; font-size: 9.5px; letter-spacing: 2px; font-weight: 900;">${t.specialty??""}</span>
        </div>
      </div>
    </div>
  `,g=N[i]??{},w=(g.baseDps??0)*1.1,E=g.attackSpeed??1,h=g.range??0,b=E>0?w/E:w,y=Y(g.damageType),S=Math.round((g.critChance??0)*100),$=g.critMult??2,f=(x,C,R="#e8d6a8")=>`<div style="background:rgba(0,0,0,0.35);padding:6px 8px;border:1px solid #3a2a1a">
       <div style="color:#aa9a4a;letter-spacing:1.5px;text-transform:uppercase;font-size:8.5px">${x}</div>
       <div style="color:${R};font-size:13px;font-weight:bold;margin-top:2px">${C}</div>
     </div>`,L=`
    <div style="font-size:9px;color:#aa9a4a;letter-spacing:2px;margin-bottom:6px">STATS</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;margin-bottom:clamp(12px,1.8vh,18px)">
      ${f("DAMAGE / HIT",b.toFixed(1),"#ee9966")}
      ${f("ATK SPEED",E.toFixed(2)+" /s")}
      ${f("RANGE",h+" tiles")}
      ${f("DPS",w.toFixed(1),"#ffbe7a")}
      ${f("CRIT",S+"%"+(S>0?" × "+$.toFixed(1):""))}
      ${f("TYPE",y,a)}
    </div>
  `,e="",r=`
    <div style="font-size: 9px; color: #aa9a4a; letter-spacing: 2px; margin-bottom: 4px;">PASSIVE</div>
    <div style="font-size: clamp(11px, 1.25vh, 13px); color: #cdb98a; line-height: 1.5; margin-bottom: clamp(12px, 1.8vh, 18px); padding: 8px 10px; background: rgba(0,0,0,0.35); border-left: 2px solid #5a4a30;">${G(t.passive)}</div>
  `,s=t.abilities??[],c=t.tierTitles??["TIRO","LEGATUS","CONSUL","IMPERATOR","DIVUS"],k=s.map(x=>{const C=c[x.level]??`T${x.level}`,R=x.cooldownSec?`${x.cooldownSec}s`:"";return`
      <div style="display: flex; gap: 8px; align-items: flex-start; margin-bottom: 8px; padding: 6px 8px; background: rgba(0,0,0,0.25); border-left: 2px solid ${a}88;">
        <div style="flex: 0 0 auto; padding: 2px 6px; background: ${a}; color: #1a0808; font-size: 8.5px; letter-spacing: 1px; font-weight: 900; min-width: 64px; text-align: center;">${C}</div>
        <div style="flex: 1; min-width: 0;">
          <div style="font-size: clamp(11px, 1.25vh, 13px); color: ${a}; font-weight: 900; letter-spacing: 1px;">${x.name??x.id}<span style="color: #aa9a4a; font-size: 9.5px; font-weight: normal; letter-spacing: 0.5px; margin-left: 8px;">⏱ ${R}</span></div>
          <div style="font-size: clamp(10px, 1.15vh, 12px); color: #cdb98a; line-height: 1.45; margin-top: 2px;">${x.description??""}</div>
        </div>
      </div>
    `}).join("");o.innerHTML=`
    ${l}
    ${v}
    ${z}
    <div style="padding: clamp(14px, 2vh, 22px) clamp(14px, 2vw, 20px);">
      ${L}
      ${e}
      ${r}
      <button data-card-expand type="button" style="
        display:none; width:100%; margin: 4px 0 10px; padding: 10px 12px;
        background: rgba(0,0,0,0.4); border: 1px dashed ${a}66; color: ${a};
        font-family:'Courier New',monospace; font-size:11px; letter-spacing:2px;
        font-weight:900; cursor:pointer; text-shadow:1px 1px 0 #000;
      ">▼ TAP FOR ${s.length||0} ABILIT${s.length===1?"Y":"IES"}</button>
      <div data-card-abilities>
        <div style="font-size: 9px; color: #aa9a4a; letter-spacing: 2px; margin-bottom: 6px; padding-top: 4px; border-top: 1px dashed #3a2a1a;">ABILITIES</div>
        ${k}
      </div>
    </div>
  `;const A=o.querySelector("[data-card-expand]"),P=o.querySelector("[data-card-abilities]");return A&&P&&A.addEventListener("click",x=>{x.stopPropagation();const C=o.dataset.expanded==="1";o.dataset.expanded=C?"0":"1",A.textContent=C?`▼ TAP FOR ${s.length||0} ABILIT${s.length===1?"Y":"IES"}`:"▲ HIDE ABILITIES"}),o}export{K as showChooseHeroModal};
