'use strict';
(() => {
  // Meriden Cross is a rounded public coordinate, not the organiser's exact
  // scoring origin. Meet-up crow distances are therefore planning estimates.
  let origin = {lat:52.4379,lng:-1.6496};
  const valid = p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat)<=90 && Math.abs(p.lng)<=180;
  function setOrigin(next) {
    if(!valid(next))return false;
    origin={lat:next.lat,lng:next.lng};return true;
  }
  function crowKm(point) {
    if(!valid(point))return null;
    const rad=Math.PI/180, dLat=(point.lat-origin.lat)*rad, dLon=(point.lng-origin.lng)*rad;
    const a=Math.sin(dLat/2)**2+Math.cos(origin.lat*rad)*Math.cos(point.lat*rad)*Math.sin(dLon/2)**2;
    return 6371.0088*2*Math.atan2(Math.sqrt(a),Math.sqrt(Math.max(0,1-a)));
  }
  window.routeDistances={setOrigin,crowKm,getOrigin:()=>({...origin})};
})();
