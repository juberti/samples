
var endpoints;
var answerDelay;
var signalingRtt;
var turnRtt;
var checkRtt;
var checkInterval;
var startTime, answerTime;
var triggeredChecks = false;//true;

function getOtherEndpoint(e) {
  return e === endpoints[0] ? endpoints[1] : endpoints[0];
}
function print(e, x) {
  var s = ((performance.now() - startTime) / 1000).toFixed(3) + ': ' + e.n + ': ' + x;
  e.o.value += (s + "\r\n");
  getOtherEndpoint(e).o.value += "\r\n";
  console.log(s);
}

function addCandidate(e, t, p) {
  var c = {"t": t, "p": p};
  print(e, "Sent candidate: " + t);
  e.lcs.push(c);
  for (var i = 0; i < e.rcs.length; ++i) {
    maybeAddConnection(e, c, e.rcs[i]);
  }
  setTimeout(function() {
    receiveCandidate(getOtherEndpoint(e), c);
  }, signalingRtt);
}
function gatherCandidate(e, t, p, rtt) {
  setTimeout(function() { addCandidate(e, t, p); }, rtt);
}
function gatherCandidates(e) {
  addCandidate(e, "host", 126);
  gatherCandidate(e, "srflx", 100, turnRtt);
  gatherCandidate(e, "relay/udp", 2, turnRtt * 2);
  gatherCandidate(e, "relay/tcp", 1, turnRtt * 3);
}

function makePermissionString(from_cand, to_cand) {
  var tt = to_cand.t, ft = from_cand.t;
  // ping from host to srflx should be treated as srflx-srflx
  if (ft === 'host' && tt !== 'host')
    ft = 'srflx';
 if (tt === 'host' && ft !== 'host')
    tt = 'srflx';
  return tt + ' <- ' + ft;
}
function hasRecvPermission(e, from_cand, to_cand) {
  if (to_cand.t === "srflx" && e.nat === "cone")
    return true;
  return (e.perms[makePermissionString(from_cand, to_cand)] === true);
}
function addRecvPermission(e, from_cand, to_cand) {
   e.perms[makePermissionString(from_cand, to_cand)] = true;
}

function findConnection(e, lc, rc) {
   for (var i = 0; i < e.conns.length; ++i) {
     if (e.conns[i].lc === lc && e.conns[i].rc === rc) {
       return e.conns[i];
    }
  }
}
function maybeAddConnection(e, lc, rc) {
  if (lc.t === 'srflx')
    return;

  // algorithm from RFC5245, S 5.7.2
  var g = (e === endpoints[0]) ? lc.p : rc.p;
  var d = (e === endpoints[0]) ? rc.p : lc.p;
  var pair_prio = Math.pow(2, 32) * Math.min(g, d) + 2 * Math.max(g, d) + ((g > d) ? 1 : 0);
  e.conns.push({"lc":lc, "rc":rc, "p":pair_prio, "ts":0, "tr":0, "w":false});
  if (lc.t.indexOf('relay') != -1 && rc.t !== 'host') {
    setTimeout(function() {
      print(e, "Created TURN permission: " + lc.t + " -> " + rc.t)
      addRecvPermission(e, rc, lc);
    }, turnRtt / 2);
  }
}

function receiveOffer() {
  print(endpoints[1], "Received offer");
  setTimeout(answer, answerDelay);
}
function receiveAnswer() {
  print(endpoints[0], "Received answer");
  startChecks(endpoints[0]);
}
function receiveCandidate(e, c) {
  print(e, "Received candidate: " + c.t);
  e.rcs.push(c);
  for (var i = 0; i < e.lcs.length; ++i) {
    maybeAddConnection(e, e.lcs[i], c);
  }
}
function receiveCheck(e, lc, rc) {
  var conn = findConnection(e, lc, rc);
  if (conn) {
    print(e, "Received check: " + lc.t + " <- " + rc.t);
    conn.tr = performance.now();
  }
}
function receiveCheckResponse(e, conn) {
  print(e, "Check successful: " + conn.lc.t + " -> " + conn.rc.t);
  conn.w = true;
  clearInterval(e.t);
  e.t = null;
  if (!e.w) {
    e.w = true;
    var s = "Connect time: " + (performance.now() - answerTime).toFixed(0) + "ms, checks: " + e.nc;
    print(e, s);
  }
}

function sendCheck(e, conn) {
  conn.ts = performance.now();
  e.nc++;
  var s = "Sent check: " + conn.lc.t + " -> " + conn.rc.t;
  var has_perm = hasRecvPermission(getOtherEndpoint(e), conn.lc, conn.rc);
  if (has_perm) {
    setTimeout(function() { receiveCheck(getOtherEndpoint(e), conn.rc, conn.lc); }, checkRtt / 2);
    setTimeout(function() { receiveCheckResponse(e, conn); }, checkRtt);
  } else {
    s += " (failed)";
  }
  print(e, s);
  if (conn.lc.t == 'host' && conn.rc.t != 'host') {
    // checks create permissions on NAT
    addRecvPermission(e, conn.rc, conn.lc);
  }
}
function sendNextCheck(e) {
  // Sort first by last check time, ascending, and then priority, descending.
  e.conns.sort(function(ca, cb) {
    if (triggeredChecks) {
      if (ca.tr > ca.ts && cb.tr < cb.ts)
        return -1
      else if (ca.tr < ca.ts && cb.tr > cb.ts)
        return 1
      else if (ca.tr > ca.ts && cb.tr > cb.ts)
        return ca.tr - cb.tr;
    }
    if (ca.ts != cb.ts)
      return ca.ts - cb.ts;
    return cb.p - ca.p;
  });
  if (e.conns.length > 0) {
    sendCheck(e, e.conns[0]);
  }
}
function startChecks(e) {
  sendNextCheck(e);
  e.t = setInterval(function() { sendNextCheck(e); }, checkInterval);
}

function offer() {
  startTime = performance.now();
  print(endpoints[0], "Sent offer");
  setTimeout(receiveOffer, signalingRtt);
  gatherCandidates(endpoints[0]);
}
function answer() {
  answerTime = performance.now();
  print(endpoints[1], "Sent answer");
  setTimeout(receiveAnswer, signalingRtt);
  gatherCandidates(endpoints[1]);
  startChecks(endpoints[1]);
}
function start() {
  var ea = {n:"A", o:output_a, nat:"addr", i:1, lcs:[], rcs:[], conns:[], perms:{}, nc:0, w:false, t:null};
  var eb = {n:"B", o:output_b, nat:"addr", i:1, lcs:[], rcs:[], conns:[], perms:{}, nc:0, w:false, t:null};
  endpoints = [ea, eb];
  ea.o.value = "";
  eb.o.value = "";
  answerDelay = adelay.value;
  signalingRtt = srtt.value;
  turnRtt = trtt.value;
  checkRtt = irtt.value;
  checkInterval = ici.value;
  offer();
}
//window.onload = function() {
 // start();
//}