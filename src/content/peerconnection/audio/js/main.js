/*
 *  Copyright (c) 2014 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
/* global TimelineDataSeries, TimelineGraphView */

/* globals maybePreferCodec, preferBitRate, setCodecParam*/
'use strict';

var audio2 = document.querySelector('audio#audio2');
var callButton = document.querySelector('button#callButton');
var hangupButton = document.querySelector('button#hangupButton');
var codecSelector = document.querySelector('select#codec');
var bitRateField = document.querySelector('input#bitrate');
var ptimeField = document.querySelector('input#ptime');
var vadCheck = document.querySelector('input#vad');
hangupButton.disabled = true;
callButton.onclick = call;
hangupButton.onclick = hangup;

var pc1;
var pc2;
var localstream;

var graph;
var bitrateSeries;
var lastBytes = 0;
var lastTime;

function gotStream(stream) {
  trace('Received local stream');
  // Call the polyfill wrapper to attach the media stream to this element.
  localstream = stream;
  var audioTracks = localstream.getAudioTracks();
  if (audioTracks.length > 0) {
    trace('Using Audio device: ' + audioTracks[0].label);
  }
  pc1.addStream(localstream);
  trace('Adding Local Stream to peer connection');

  pc1.createOffer(gotDescription1, onCreateSessionDescriptionError);

  bitrateSeries = new TimelineDataSeries();
  graph = new TimelineGraphView('graph', 'graphCanvas');
  graph.updateEndDate();
}

function onCreateSessionDescriptionError(error) {
  trace('Failed to create session description: ' + error.toString());
}

function call() {
  callButton.disabled = true;
  hangupButton.disabled = false;
  codecSelector.disabled = true;
  bitRateField.disabled = true;
  ptimeField.disabled = true;
  vadCheck.disabled = true;
  trace('Starting call');
  pc1 = new RTCPeerConnection(null, null);
  trace('Created local peer connection object pc1');
  pc1.onicecandidate = iceCallback1;
  pc2 = new RTCPeerConnection(null, null);
  trace('Created remote peer connection object pc2');
  pc2.onicecandidate = iceCallback2;
  pc2.onaddstream = gotRemoteStream;
  trace('Requesting local stream');
  // Call into getUserMedia via the polyfill (adapter.js).
  getUserMedia({
      audio: true,
      video: false
    },
    gotStream, function(e) {
      alert('getUserMedia() error: ' + e.name);
    });
}

function gotDescription1(desc) {
  trace('Offer from pc1 \n' + desc.sdp);
  pc1.setLocalDescription(desc, function() {
    pc2.setRemoteDescription(desc, function() {
      // We configure VAD for the answer SDP here.
      var sdpConstraints = {
        'mandatory': {
          'VoiceActivityDetection': vadCheck.checked
        }
      };
      pc2.createAnswer(gotDescription2, onCreateSessionDescriptionError,
          sdpConstraints);
    });
  });
}

function gotDescription2(desc) {
  desc.sdp = applyParamsToSdp(desc.sdp);
  pc2.setLocalDescription(desc, function() {
    trace('Answer from pc2 \n' + desc.sdp);
    pc1.setRemoteDescription(desc);
  });
}

function hangup() {
  trace('Ending call');
  pc1.close();
  pc2.close();
  pc1 = null;
  pc2 = null;
  hangupButton.disabled = true;
  callButton.disabled = false;
  codecSelector.disabled = false;
  bitRateField.disabled = false;
  ptimeField.disabled = false;
  vadCheck.disabled = false;
}

function gotRemoteStream(e) {
  // Call the polyfill wrapper to attach the media stream to this element.
  attachMediaStream(audio2, e.stream);
  trace('Received remote stream');
}

function iceCallback1(event) {
  if (event.candidate) {
    pc2.addIceCandidate(new RTCIceCandidate(event.candidate),
        onAddIceCandidateSuccess, onAddIceCandidateError);
    trace('Local ICE candidate: \n' + event.candidate.candidate);
  }
}

function iceCallback2(event) {
  if (event.candidate) {
    pc1.addIceCandidate(new RTCIceCandidate(event.candidate),
        onAddIceCandidateSuccess, onAddIceCandidateError);
    trace('Remote ICE candidate: \n ' + event.candidate.candidate);
  }
}

function onAddIceCandidateSuccess() {
  trace('AddIceCandidate success.');
}

function onAddIceCandidateError(error) {
  trace('Failed to add ICE Candidate: ' + error.toString());
}

// Sets m= codec ordering, b= bitrate, and a=ptime based on the in-page prefs.
function applyParamsToSdp(sdp) {
  var newSdp = maybePreferCodec(sdp, 'audio', 'send', codecSelector.value);
  if (bitRateField.value > 0) {
    newSdp = preferBitRate(newSdp, bitRateField.value / 1000, 'audio');
  }
  if (ptimeField.value > 0) {
    newSdp += ('a=ptime:' + ptimeField.value + '\r\n');
  }
  // Since Chrome doesn't currently set Opus DTX based on the
  // VoiceActivityDetection value, we can clumsily set it here.
  if (vadCheck.checked) {
    newSdp = setCodecParam(newSdp, 'opus/48000', 'usedtx', '1');
  }
  return newSdp;
}

// query getStats every second
if (webrtcDetectedBrowser === 'chrome') {
  window.setInterval(function() {
    if (!window.pc1) {
      return;
    }
    window.pc1.getStats(function(res) {
      res.result().forEach(function(report) {
        var bytes;
        var now = report.timestamp;
        if (report.type === 'ssrc' && report.stat('bytesSent')) {
          bytes = report.stat('bytesSent');
          if (lastTime) {
            // calculate bitrate
            var bitrate = 8 * (bytes - lastBytes) / (now - lastTime);

            // append to chart
            bitrateSeries.addPoint(now, bitrate);
            graph.setDataSeries([bitrateSeries]);
            graph.updateEndDate();
          }
          lastBytes = bytes;
          lastTime = now;
        }
      });
    });
  }, 1000);
}
