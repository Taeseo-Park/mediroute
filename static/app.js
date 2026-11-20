'use strict';

// UI-only state. The user's exact location is not persisted or sent before a route request.
const state = {
  screen: 'intake', catalog: {}, department: '정형외과', category: '무릎', detail: '',
  hospitals: [], professors: [], shown: 5, chosenProfessor: null,
  origin: null, mode: 'car', route: null,
  map: null, originMarker: null, destinationMarker: null, routePolyline: null
};
const $ = id => document.getElementById(id);
const modeLabels = {car:'자동차',transit:'대중교통',walk:'도보',bike:'자전거'};
const kakaoModes = {car:'car',transit:'traffic',walk:'walk',bike:'bicycle'};
const scoreLimit = Number(document.querySelector('.app-shell').dataset.limit);

function notice(id, message, type='') {
  const target = $(id);
  target.textContent = message;
  target.className = `${id === 'distanceNotice' ? 'notice' : 'inline-status'} ${type}`;
}
function text(tag, content, className) {
  const node = document.createElement(tag);
  node.textContent = content;
  if (className) node.className = className;
  return node;
}
function showScreen(name) {
  state.screen = name;
  for (const step of ['intake','results','route']) {
    $(`screen-${step}`).hidden = step !== name;
    document.querySelector(`[data-progress="${step}"]`).classList.toggle('active', step === name);
  }
  window.scrollTo(0,0);
  if (name === 'route') {
    requestAnimationFrame(() => {
      initializeMap();
      if (state.map) {
        state.map.relayout();
        updateMapViewport();
      }
    });
  }
}
async function jsonFetch(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
function populateDepartments() {
  const select = $('departmentSelect');
  select.replaceChildren();
  Object.keys(state.catalog).forEach(department => {
    const opt = document.createElement('option');
    opt.value = department;
    opt.textContent = department;
    select.appendChild(opt);
  });
  select.value = state.department;
  renderCategories();
}
function renderCategories() {
  state.department = $('departmentSelect').value;
  const categories = Object.keys(state.catalog[state.department] || {});
  if (!categories.includes(state.category)) state.category = categories[0] || '';
  const root = $('bodyChoices'); root.replaceChildren();
  categories.forEach(category => {
    const button = text('button', category, `choice ${category===state.category?'active':''}`);
    button.type = 'button'; button.setAttribute('aria-pressed', String(category===state.category));
    button.addEventListener('click', () => {state.category=category;state.detail='';renderCategories();});
    root.appendChild(button);
  });
  renderDetails();
}
function renderDetails() {
  const root = $('detailChoices'); root.replaceChildren();
  const details = state.catalog[state.department]?.[state.category] || [];
  if (!details.includes(state.detail)) state.detail = details[0] || '';
  details.forEach(detail => {
    const button = text('button', detail, `choice ${detail === state.detail ? 'active':''}`);
    button.type='button'; button.setAttribute('aria-pressed',String(detail===state.detail));
    button.addEventListener('click', () => {state.detail=detail;renderDetails();});
    root.appendChild(button);
  });
  $('selectionSummary').replaceChildren(
    text('strong',state.detail || '세부 분야를 선택해 주세요'),
    text('span',`${state.department} · ${state.category}  |  추천 기준: ${state.category} 분야의 가상 전문성 점수`)
  );
}
function hospitalFor(professor) {return state.hospitals.find(h => h.id === professor.hospital_id);}
function toRadians(n) {return n*Math.PI/180;}
function directDistance(lat1,lon1,lat2,lon2) {
  const dLat=toRadians(lat2-lat1),dLon=toRadians(lon2-lon1);
  const a=Math.sin(dLat/2)**2+Math.cos(toRadians(lat1))*Math.cos(toRadians(lat2))*Math.sin(dLon/2)**2;
  return 6371.0088*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function formatDistance(hospital) {
  if (!hospital) return '병원 위치 미연동';
  if (!state.origin) return '내 위치 설정 시 거리 표시';
  return `직선거리 약 ${directDistance(state.origin.lat,state.origin.lng,hospital.lat,hospital.lng).toFixed(1)} km`;
}
async function getRecommendations() {
  const button = $('recommendBtn');button.disabled=true;button.textContent='교수 추천 조회 중...';
  notice('intakeStatus','진료 전문성 기준으로 가상 교수 데이터를 정렬합니다.');
  try {
    const qs = new URLSearchParams({department:state.department,condition:state.category});
    const data = await jsonFetch(`/api/recommendations?${qs.toString()}`);
    state.professors = data.results || [];state.shown=5;
    showScreen('results');renderRecommendations();
    requestDistanceLocation();
    notice('intakeStatus','');
  } catch (error) {notice('intakeStatus',`추천 조회 실패: ${error.message}`,'error');}
  finally {button.disabled=false;button.innerHTML='추천 교수 보기 <span aria-hidden="true">→</span>';}
}
function renderRecommendations() {
  const root=$('recommendations');root.replaceChildren();
  $('resultsTitle').textContent=`${state.category} 분야 추천 교수`;
  $('resultsDescription').textContent=`${state.department} · ${state.detail} · 진료 전문성 점수 기준 (시연용)`;
  $('recommendationCount').textContent=`추천 교수 ${state.professors.length}명 · ${Math.min(state.shown,state.professors.length)}명 표시`;
  if (!state.professors.length) {
    root.appendChild(text('div','해당 분야의 교수 데이터가 아직 없습니다. DB 연동 후 결과를 제공할 예정입니다.','empty-route'));
  }
  for (const professor of state.professors.slice(0,state.shown)) {
    const hospital = hospitalFor(professor);
    const card = document.createElement('article');card.className='professor-card';
    const main=document.createElement('div'); main.className='professor-info';
    const top=document.createElement('div'); top.className='professor-identity';
    top.append(text('span',String(professor.rank).padStart(2,'0'),'professor-rank'),text('strong',professor.name));
    top.append(text('span','가상 데이터','tag-amber'));
    main.append(top);
    main.append(text('p',`${hospital?.name || '병원 미연동'} · ${professor.department}`,'professor-affiliation'));
    main.append(text('p',`진료 분야: ${professor.specialty}`,'professor-specialty'));
    main.append(text('div',`전문성 ${professor.expertise_score_100.toFixed(1)}점  (적합성 ${(professor.fitness_score*100).toFixed(0)} · 경력 ${(professor.career_score*100).toFixed(0)})`,'expertise-score'));
    main.append(text('span',formatDistance(hospital),'distance-text'));
    const action=document.createElement('div');action.className='professor-actions';
    if (hospital) {
      const button=text('button','길찾기 ↗','btn btn-outline navigate-btn');button.type='button';
      button.setAttribute('aria-label',`${professor.name}의 소속 병원 ${hospital.name} 길찾기`);
      button.addEventListener('click',()=>openRouteFor(professor));action.appendChild(button);
    } else {action.appendChild(text('span','병원 연동 대기','muted'));}
    card.append(main,action);root.appendChild(card);
  }
  $('showMoreRecommendations').hidden=state.shown>=state.professors.length;
}
function requestDistanceLocation() {
  if(state.origin) {
    notice('distanceNotice','현재 설정된 위치를 기준으로 직선거리를 표시합니다. 실제 이동거리는 길찾기에서 확인할 수 있어요.','success');
    renderRecommendations();return;
  }
  if (!navigator.geolocation) {
    makeLocationRequestButton('현재 위치를 사용할 수 없어 거리 표시를 생략했어요. 길찾기 화면에서 직접 출발지를 선택할 수 있습니다.');
    return;
  }
  navigator.geolocation.getCurrentPosition(position=>{
    setOrigin(position.coords.latitude,position.coords.longitude,'내 현재 위치',false);
    notice('distanceNotice','현재 위치 기준 직선거리를 표시합니다. 길찾기 화면에서 실제 이동거리를 확인할 수 있어요.','success');
  },()=>makeLocationRequestButton('위치 권한이 없어 거리를 표시하지 못했어요. 길찾기에서 출발지를 검색하거나 다시 위치를 허용할 수 있습니다.'),
  {enableHighAccuracy:true,timeout:12000,maximumAge:60000});
}
function makeLocationRequestButton(message) {
  const root=$('distanceNotice');root.className='notice';root.replaceChildren(text('span',message));
  const button=text('button','현재 위치 다시 확인','notice-action');
  button.type='button';button.addEventListener('click',requestDistanceLocation);
  root.appendChild(button);
}
function openRouteFor(professor) {
  const hospital=hospitalFor(professor);if(!hospital)return;
  state.chosenProfessor=professor;state.route=null;
  $('destinationName').textContent=hospital.name;
  $('destinationAddress').textContent=hospital.address;
  $('destinationDoctor').textContent=`선택한 교수: ${professor.name} · ${professor.department}`;
  $('originLabel').textContent=state.origin?.name||'아직 선택되지 않았어요';
  $('routeBtn').disabled=!state.origin;
  $('openKakaoMap').hidden=true;
  $('routeResult').innerHTML='<div class="empty-route">출발지와 교통수단을 선택한 후<br>길찾기 버튼을 눌러주세요.</div>';
  notice('routeStatus',state.origin?'출발지가 설정됐습니다. 교통수단 선택 후 길찾기를 눌러 주세요.':'출발지를 설정해 주세요.');
  showScreen('route');
}
function setOrigin(lat,lng,name,updateRoute=true) {
  state.origin={lat:Number(lat),lng:Number(lng),name};
  $('originLabel').textContent=name;
  $('routeBtn').disabled=false;
  renderRecommendations();
  if(updateRoute) {resetRoute('출발지가 변경됐습니다. 다시 길찾기를 눌러 주세요.');}
  updateOriginMarker(); updateMapViewport();
}
function resetRoute(message) {
  state.route=null;clearPolyline();$('openKakaoMap').hidden=true;
  $('routeResult').innerHTML='<div class="empty-route">변경된 출발지 또는 교통수단으로<br>길찾기를 다시 실행해 주세요.</div>';
  notice('routeStatus',message);
}
function locate() {
  if(!navigator.geolocation) {notice('routeStatus','이 브라우저에서 위치 기능을 사용할 수 없습니다. 장소 검색을 이용하세요.','error');return;}
  notice('routeStatus','현재 위치를 확인하고 있습니다...');
  navigator.geolocation.getCurrentPosition(position=>{
    setOrigin(position.coords.latitude,position.coords.longitude,'내 현재 위치');
    notice('routeStatus','출발지를 설정했습니다. 길찾기를 실행해 주세요.','success');
  },error=>{
    const msg={1:'위치 권한이 거부되었습니다.',2:'현재 위치를 찾을 수 없습니다.',3:'위치 조회 시간이 초과되었습니다.'}[error.code]||error.message;
    notice('routeStatus',`${msg} 장소 검색 또는 지도 클릭을 사용해 주세요.`,'error');
  },{enableHighAccuracy:true,timeout:12000,maximumAge:0});
}
async function searchLocation(event) {
  event.preventDefault();
  const query=$('searchInput').value.trim();
  if(query.length<2){notice('routeStatus','장소 이름을 두 글자 이상 입력해 주세요.','error');return;}
  notice('routeStatus',`'${query}' 장소 검색 중...`);
  try {
    const data=await jsonFetch(`/api/search?q=${encodeURIComponent(query)}`);
    const root=$('searchResults');root.replaceChildren();root.hidden=false;
    if(!data.results?.length){root.appendChild(text('div','검색 결과가 없습니다.','empty-search'));return;}
    data.results.forEach(item=>{
      const button=document.createElement('button');button.type='button';button.className='search-choice';
      button.append(text('strong',item.name),text('small',item.address||''));
      button.addEventListener('click',()=>{
        setOrigin(item.lat,item.lng,item.name);root.hidden=true;$('searchInput').value=item.name;
        notice('routeStatus','출발지를 설정했습니다. 길찾기를 실행해 주세요.','success');
      });
      root.appendChild(button);
    });
    notice('routeStatus',`${data.results.length}개의 검색 결과입니다. 출발지를 선택해 주세요.`);
  }catch(error){notice('routeStatus',`장소 검색 실패: ${error.message}`,'error');}
}
function selectMode(mode) {
  state.mode=mode;
  document.querySelectorAll('.mode').forEach(button=>{
    const active=button.dataset.mode===mode;
    button.classList.toggle('active',active);
    button.setAttribute('aria-pressed',String(active));
  });
  resetRoute(`${modeLabels[mode]}으로 변경했습니다. 길찾기를 실행해 주세요.`);
}
async function calculateRoute() {
  const hospital=hospitalFor(state.chosenProfessor);
  if(!hospital||!state.origin)return;
  const button=$('routeBtn');button.disabled=true;button.textContent='경로를 계산하고 있습니다...';
  notice('routeStatus',`${modeLabels[state.mode]} 경로 조회 중...`);
  try {
    const data=await jsonFetch('/api/route',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({hospital_id:hospital.id,lat:state.origin.lat,lng:state.origin.lng,mode:state.mode})
    });
    state.route=data.hospital;
    renderRouteResult(); updateRoutePolyline();
    if(state.route.status==='ok'){
      notice('routeStatus',`${modeLabels[state.mode]} 길찾기 완료 · ${Math.ceil(state.route.duration_seconds/60)}분`,'success');
    } else notice('routeStatus',`경로 API 조회 실패: ${state.route.error||'경로를 찾을 수 없습니다.'}`,'error');
  }catch(error){
    state.route=null;clearPolyline();
    $('routeResult').replaceChildren(text('div',`경로 조회 실패: ${error.message}`,'route-error'));
    notice('routeStatus',`경로 조회 실패: ${error.message}`,'error');
  }finally{
    button.disabled=false;button.innerHTML='경로·이동시간 확인 <span aria-hidden="true">→</span>';
    updateExternalLink();
  }
}
function renderRouteResult() {
  const root=$('routeResult');root.replaceChildren();
  const result=state.route;if(!result)return;
  if(result.status!=='ok'){
    root.append(text('div','경로 API에서 이동시간을 가져오지 못했습니다.','route-error'),text('small',result.error||'다시 시도해 주세요.','muted'));
    return;
  }
  root.appendChild(text('p',`${modeLabels[state.mode]} 길찾기 결과`,'route-result-title'));
  const stats=document.createElement('div');stats.className='stat-grid';
  const values=[
    ['예상 소요시간',`${Math.ceil(result.duration_seconds/60)}분`],
    ['실제 경로 거리',`${result.distance_km.toFixed(2)} km`],
    [`접근성 점수 (${scoreLimit}분 기준)`,`${result.score_100.toFixed(1)}점`]
  ];
  for(const [label,value] of values){const box=document.createElement('div');box.className='stat';box.append(text('span',label),text('strong',value));stats.append(box);}
  root.appendChild(stats);
}
function externalRouteUrl() {
  const hospital=hospitalFor(state.chosenProfessor);
  if(!hospital||!state.origin)return null;
  const candidate=state.route?.kakao_route_url;
  if(candidate){try {const url=new URL(candidate);if(url.protocol==='https:'&&url.hostname==='map.kakao.com')return url.href;}catch {/* fallback */}}
  const origin=`${encodeURIComponent(state.origin.name)},${state.origin.lat},${state.origin.lng}`;
  const destination=`${encodeURIComponent(hospital.name)},${hospital.lat},${hospital.lng}`;
  return `https://map.kakao.com/link/by/${kakaoModes[state.mode]}/${origin}/${destination}`;
}
function updateExternalLink(){
  const link=$('openKakaoMap'),url=externalRouteUrl();link.hidden=!url;
  if(url)link.href=url;
}
function clearPolyline(){if(state.routePolyline){state.routePolyline.setMap(null);state.routePolyline=null;}}
function updateOriginMarker(){
  if(!state.map)return;
  if(state.originMarker){state.originMarker.setMap(null);state.originMarker=null;}
  if(state.origin){state.originMarker=new kakao.maps.Marker({map:state.map,position:new kakao.maps.LatLng(state.origin.lat,state.origin.lng),title:'출발지'});}
}
function updateDestinationMarker(){
  if(!state.map)return;
  if(state.destinationMarker){state.destinationMarker.setMap(null);state.destinationMarker=null;}
  const hospital=hospitalFor(state.chosenProfessor);
  if(hospital){state.destinationMarker=new kakao.maps.Marker({map:state.map,position:new kakao.maps.LatLng(hospital.lat,hospital.lng),title:hospital.name});}
}
function updateMapViewport(){
  if(!state.map)return;
  updateDestinationMarker();
  const hospital=hospitalFor(state.chosenProfessor);if(!hospital)return;
  const bounds=new kakao.maps.LatLngBounds();
  bounds.extend(new kakao.maps.LatLng(hospital.lat,hospital.lng));
  if(state.origin)bounds.extend(new kakao.maps.LatLng(state.origin.lat,state.origin.lng));
  if(state.route?.path){state.route.path.forEach(p=>{if(p.length>=2)bounds.extend(new kakao.maps.LatLng(p[0],p[1]));});}
  if(!state.origin){state.map.setCenter(new kakao.maps.LatLng(hospital.lat,hospital.lng));state.map.setLevel(5);}
  else state.map.setBounds(bounds,40,40,40,40);
  $('mapSubtitle').textContent=hospital.name;
}
function updateRoutePolyline(){
  if(!state.map)return;
  clearPolyline();
  if(state.route?.status==='ok'&&Array.isArray(state.route.path)&&state.route.path.length>1){
    const path=state.route.path.filter(pair=>pair.length>=2).map(pair=>new kakao.maps.LatLng(pair[0],pair[1]));
    if(path.length>1){state.routePolyline=new kakao.maps.Polyline({path,map:state.map,strokeWeight:5,strokeColor:'#1868d4',strokeOpacity:.88});}
  }
  updateMapViewport();
}
function initializeMap(){
  if(state.map)return;
  const placeholder=$('mapPlaceholder');
  if(typeof kakao==='undefined'||!kakao.maps){placeholder.hidden=false;return;}
  try{
    kakao.maps.load(()=>{
      const hospital=hospitalFor(state.chosenProfessor);
      if(!hospital)return;
      state.map=new kakao.maps.Map($('map'),{center:new kakao.maps.LatLng(hospital.lat,hospital.lng),level:6});
      kakao.maps.event.addListener(state.map,'click',event=>{
        const pos=event.latLng;
        setOrigin(pos.getLat(),pos.getLng(),`지도에서 선택 (${pos.getLat().toFixed(4)}, ${pos.getLng().toFixed(4)})`);
        notice('routeStatus','지도에서 출발지를 선택했습니다. 길찾기를 눌러 주세요.','success');
      });
      updateOriginMarker();updateMapViewport();
      placeholder.hidden=true;
    });
  }catch{placeholder.hidden=false;}
}
async function start(){
  $('departmentSelect').addEventListener('change',()=>{state.category='';state.detail='';renderCategories();});
  $('recommendBtn').addEventListener('click',getRecommendations);
  $('resultsBack').addEventListener('click',()=>showScreen('intake'));
  $('routeBack').addEventListener('click',()=>showScreen('results'));
  $('showMoreRecommendations').addEventListener('click',()=>{state.shown=Math.min(state.professors.length,state.shown+5);renderRecommendations();});
  $('locateBtn').addEventListener('click',locate);
  $('searchForm').addEventListener('submit',searchLocation);
  $('routeBtn').addEventListener('click',calculateRoute);
  document.querySelectorAll('.mode').forEach(btn=>btn.addEventListener('click',()=>selectMode(btn.dataset.mode)));
  try{
    const [catalog,hospitals]=await Promise.all([jsonFetch('/api/specialties'),jsonFetch('/api/hospitals')]);
    state.catalog=catalog.departments||{};
    state.hospitals=hospitals.hospitals||[];
    populateDepartments();
  }catch(error){
    $('recommendBtn').disabled=true;
    notice('intakeStatus',`기본 정보 조회 실패: ${error.message}`,'error');
  }
}
document.addEventListener('DOMContentLoaded',start);
