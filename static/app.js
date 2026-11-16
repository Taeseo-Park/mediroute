'use strict';

const state = {map:null, hospitalData:[], markers:[], originMarker:null, polyline:null,
               origin:null, mode:'car', results:[], selectedId:null};
const el = (id) => document.getElementById(id);
const scoreLimit = Number(document.querySelector('.app-shell').dataset.limit);
const modeNames = {car:'자동차', transit:'대중교통', walk:'도보', bike:'자전거'};
const kakaoMode = {car:'car', transit:'traffic', walk:'walk', bike:'bicycle'};
const defaultCenter = {lat:37.330, lng:127.080};

function status(message, kind='') {
  const node=el('status'); node.textContent=message; node.className=`status ${kind}`;
}
function setOrigin(lat,lng,name) {
  state.origin={lat:Number(lat),lng:Number(lng),name};
  el('originLabel').textContent=name;
  el('compareBtn').disabled=false;
  state.results=[]; state.selectedId=null; clearPolyline();
  el('results').innerHTML='<div class="empty-state"><div>✓</div><strong>출발지 설정 완료</strong><p>교통수단을 선택하고 비교 버튼을 눌러주세요.</p></div>';
  if(state.map){
    if(state.originMarker) state.originMarker.setMap(null);
    state.originMarker=new kakao.maps.Marker({map:state.map,position:new kakao.maps.LatLng(lat,lng)});
    state.map.panTo(new kakao.maps.LatLng(lat,lng));
    state.map.setLevel(6);
  }
  status(`${name}에서 ${modeNames[state.mode]} 이동시간을 계산할 준비가 됐습니다.`, 'success');
}
function clearPolyline(){
  if(state.polyline){state.polyline.setMap(null);state.polyline=null;}
}
function drawRoute(item){
  if(!state.map||!state.origin||!item||item.status!=='ok')return;
  clearPolyline();
  const points=(item.path||[]).filter(p=>p.length>=2).map(p=>new kakao.maps.LatLng(p[0],p[1]));
  if(points.length>1){
    state.polyline=new kakao.maps.Polyline({path:points,strokeWeight:5,strokeColor:'#1676df',strokeOpacity:.86,strokeStyle:'solid'});
    state.polyline.setMap(state.map);
  }
  const bounds=new kakao.maps.LatLngBounds();
  bounds.extend(new kakao.maps.LatLng(state.origin.lat,state.origin.lng));
  bounds.extend(new kakao.maps.LatLng(item.lat,item.lng));
  points.forEach(p=>bounds.extend(p));
  state.map.setBounds(bounds,45,45,45,45);
  el('mapSubtitle').textContent=`${item.name} · ${modeNames[state.mode]} ${Math.ceil(item.duration_seconds/60)}분`;
}
function safeUrl(url){
  try{ const u=new URL(url); return u.protocol==='https:'&&u.hostname==='map.kakao.com' ? u.href : null; }
  catch{return null;}
}
function externalRouteUrl(item){
  const returned=safeUrl(item.kakao_route_url); if(returned)return returned;
  if(!state.origin||item.lat===undefined)return null;
  const start=`${encodeURIComponent('출발지')},${state.origin.lat},${state.origin.lng}`;
  const destination=`${encodeURIComponent(item.name)},${item.lat},${item.lng}`;
  return `https://map.kakao.com/link/by/${kakaoMode[state.mode]}/${start}/${destination}`;
}
function renderResults(){
  const root=el('results');root.replaceChildren();
  if(!state.results.length){
    root.innerHTML='<div class="empty-state"><div>🏥</div><strong>아직 결과가 없습니다.</strong></div>';return;
  }
  state.results.forEach(item=>{
    const card=document.createElement('div');
    const ok=item.status==='ok';
    card.className=`result-card${!ok?' unavailable':''}${item.id===state.selectedId?' selected':''}`;
    if(ok){card.setAttribute('role','button');card.setAttribute('tabindex','0');}
    const rank=document.createElement('div');rank.className='rank';rank.textContent=ok?`${item.rank}`:'—';
    const content=document.createElement('div');content.className='result-content';
    const name=document.createElement('strong');name.textContent=item.name;content.appendChild(name);
    const address=document.createElement('span');address.className='address';address.textContent=item.address;content.appendChild(address);
    const eta=document.createElement('span');eta.className='eta';eta.textContent=ok ? `예상 ${Math.ceil(item.duration_seconds/60)}분 · ${item.distance_km} km` : `조회 불가 · ${item.error||'경로 없음'}`;content.appendChild(eta);
    if(ok){
      const url=externalRouteUrl(item);
      if(url){const link=document.createElement('a');link.className='route-external';link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.textContent='카카오맵에서 길찾기 보기 ↗';link.addEventListener('click',e=>e.stopPropagation());content.appendChild(link);}
    }
    const score=document.createElement('div');score.className='score-box';
    const number=document.createElement('span');number.className='score';number.textContent=ok?`${item.score_100}`:'조회 불가';score.appendChild(number);
    const unit=document.createElement('span');unit.className='score-unit';unit.textContent=ok?'접근성 점수 / 100':'점수 산출 제외';score.appendChild(unit);
    card.append(rank,content,score);
    if(ok){
      const select=()=>{state.selectedId=item.id;drawRoute(item);renderResults();};
      card.addEventListener('click',select);
      card.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select();}});
    }
    root.appendChild(card);
  });
}
async function jsonFetch(url,options){
  const res=await fetch(url,options);const data=await res.json();
  if(!res.ok)throw new Error(data.error||`HTTP ${res.status}`);
  return data;
}
function initMap(){
  if(typeof kakao==='undefined'||!kakao.maps){
    el('mapPlaceholder').hidden=false;
    el('mapPlaceholder').textContent='지도를 로딩할 수 없습니다. .env의 JavaScript 키와 카카오 SDK 도메인 등록을 확인하세요.';
    return;
  }
  kakao.maps.load(()=>{
    state.map=new kakao.maps.Map(el('map'),{center:new kakao.maps.LatLng(defaultCenter.lat,defaultCenter.lng),level:10});
    kakao.maps.event.addListener(state.map,'click',event=>{
      const p=event.latLng;setOrigin(p.getLat(),p.getLng(),`지도 선택 위치 (${p.getLat().toFixed(5)}, ${p.getLng().toFixed(5)})`);
    });
    renderHospitalMarkers();
  });
}
function renderHospitalMarkers(){
  if(!state.map||!state.hospitalData.length)return;
  state.markers.forEach(m=>m.setMap(null));state.markers=[];
  const bounds=new kakao.maps.LatLngBounds();
  state.hospitalData.forEach(h=>{
    const position=new kakao.maps.LatLng(h.lat,h.lng);
    bounds.extend(position);
    const marker=new kakao.maps.Marker({position,map:state.map,title:h.name});
    state.markers.push(marker);
    const bubble=new kakao.maps.InfoWindow({content:`<div style="padding:6px 10px;font:12px sans-serif;white-space:nowrap">${h.name}</div>`});
    kakao.maps.event.addListener(marker,'click',()=>{bubble.open(state.map,marker);});
  });
  if(!state.origin)state.map.setBounds(bounds);
}
async function loadHospitals(){
  try{
    const data=await jsonFetch('/api/hospitals');state.hospitalData=data.hospitals;renderHospitalMarkers();
    status('5개 병원 좌표를 불러왔습니다. 출발지를 선택하세요.');
  }catch(err){status(`병원 위치 조회 실패: ${err.message}`,'error');}
}
function setSearchResults(items){
  const root=el('searchResults');root.replaceChildren();root.hidden=false;
  if(!items.length){root.textContent='검색 결과가 없습니다.';return;}
  items.forEach(item=>{
    const button=document.createElement('button');button.type='button';button.className='search-choice';
    const strong=document.createElement('strong');strong.textContent=item.name;
    const small=document.createElement('small');small.textContent=item.address;
    button.append(strong,small);
    button.addEventListener('click',()=>{setOrigin(item.lat,item.lng,item.name);root.hidden=true;el('searchInput').value=item.name;});
    root.appendChild(button);
  });
}
async function search(e){
  e.preventDefault();const query=el('searchInput').value.trim();
  if(query.length<2){status('장소 검색어를 2자 이상 입력하세요.','error');return;}
  status(`'${query}' 검색 중...`);
  try{const data=await jsonFetch(`/api/search?q=${encodeURIComponent(query)}`);setSearchResults(data.results);status(`${data.results.length}개 검색 결과입니다. 출발지를 선택하세요.`);}
  catch(err){status(`장소 검색 실패: ${err.message}`,'error');}
}
function locate(){
  if(!navigator.geolocation){status('이 브라우저는 위치 기능을 지원하지 않습니다. 장소를 검색해 주세요.','error');return;}
  status('현재 위치 권한을 확인하고 있습니다...');
  navigator.geolocation.getCurrentPosition(pos=>{
    setOrigin(pos.coords.latitude,pos.coords.longitude,'내 현재 위치');
  },err=>{
    const reason={1:'위치 권한이 거부되었습니다.',2:'현재 위치를 확인할 수 없습니다.',3:'위치 조회 시간이 초과되었습니다.'}[err.code]||err.message;
    status(`${reason} 장소 검색 또는 지도 클릭을 사용해 주세요.`,'error');
  },{enableHighAccuracy:true,timeout:12000,maximumAge:0});
}
async function compare(){
  if(!state.origin)return;
  const button=el('compareBtn');button.disabled=true;button.textContent='병원별 경로 계산 중...';
  status(`${modeNames[state.mode]} 기준 5개 병원의 실제 경로 API를 조회하고 있습니다.`);
  try{
    const data=await jsonFetch('/api/evaluate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lat:state.origin.lat,lng:state.origin.lng,mode:state.mode})});
    state.results=data.results;state.selectedId=null;renderResults();
    const good=state.results.filter(r=>r.status==='ok');
    if(good.length){
      state.selectedId=good[0].id;drawRoute(good[0]);renderResults();
      status(`${good.length}개 병원의 이동시간 계산 완료. 목록에서 병원을 선택해 경로를 확인하세요.`,'success');
    }else{clearPolyline();status('5개 병원의 경로 조회에 실패했습니다. 응답 오류 및 API 설정을 확인하세요.','error');}
  }catch(err){status(`경로 비교 실패: ${err.message}`,'error');}
  finally{button.disabled=false;button.innerHTML='5개 병원 접근성 비교 <span>→</span>';}
}
function init(){
  document.querySelectorAll('.mode').forEach(button=>button.addEventListener('click',()=>{
    state.mode=button.dataset.mode;
    document.querySelectorAll('.mode').forEach(b=>{const active=b===button;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
    state.results=[];state.selectedId=null;clearPolyline();
    el('results').innerHTML='<div class="empty-state"><div>🔁</div><strong>교통수단이 변경됐습니다.</strong><p>비교 버튼을 눌러 이동시간을 다시 계산해 주세요.</p></div>';
    el('mapSubtitle').textContent='경기 남부 5개 대학병원';
  }));
  el('locateBtn').addEventListener('click',locate);
  el('searchForm').addEventListener('submit',search);
  el('compareBtn').addEventListener('click',compare);
  initMap();loadHospitals();
}
document.addEventListener('DOMContentLoaded',init);
