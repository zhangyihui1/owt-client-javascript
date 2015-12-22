/* global window, mozRTCSessionDescription, mozRTCPeerConnection, mozRTCIceCandidate */

Erizo.FirefoxStack = function (spec) {
    'use strict';

    var that = {},
        WebkitRTCPeerConnection = mozRTCPeerConnection,
        RTCSessionDescription = mozRTCSessionDescription,
        RTCIceCandidate = mozRTCIceCandidate;

    that.pc_config = {
        iceServers: []
    };

    if (spec.iceServers instanceof Array) {
        that.pc_config.iceServers = spec.iceServers;
    } else {
        if (spec.stunServerUrl) {
            if (spec.stunServerUrl instanceof Array) {
                spec.stunServerUrl.map(function (url) {
                    if (typeof url === 'string' && url !== '') {
                        that.pc_config.iceServers.push({urls: url});
                    }
                });
            } else if (typeof spec.stunServerUrl === 'string' && spec.stunServerUrl !== '') {
                that.pc_config.iceServers.push({urls: spec.stunServerUrl});
            }
        }

        if (spec.turnServer) {
            if (spec.turnServer instanceof Array) {
                spec.turnServer.map(function (turn) {
                    if (typeof turn.url === 'string' && turn.url !== '') {
                        that.pc_config.iceServers.push({
                            username: turn.username,
                            credential: turn.password,
                            urls: turn.url
                        });
                    }
                });
            } else if (typeof spec.turnServer.url === 'string' && spec.turnServer.url !== '') {
                that.pc_config.iceServers.push({
                    username: spec.turnServer.username,
                    credential: spec.turnServer.password,
                    urls: spec.turnServer.url
                });
            }
        }
    }

    if (spec.audio === undefined) {
        spec.audio = true;
    }

    if (spec.video === undefined) {
        spec.video = true;
    }

    that.mediaConstraints = {
        offerToReceiveAudio: spec.audio,
        offerToReceiveVideo: spec.video,
        mozDontOfferDataChannel: true
    };

    var errorCallback = function (message) {
        L.Logger.error("Error in Stack ", message);
    };
    var gotCandidate = false;
    that.peerConnection = new WebkitRTCPeerConnection(that.pc_config);

    spec.localCandidates = [];

    that.peerConnection.onicecandidate =  function (event) {
        if (event.candidate) {
            gotCandidate = true;

            if (!event.candidate.candidate.match(/a=/)) {
                event.candidate.candidate ="a="+event.candidate.candidate;
            }

            if (spec.remoteDescriptionSet) {
                spec.callback({type:'candidate', candidate: event.candidate});
            } else {
                spec.localCandidates.push(event.candidate);
                console.log("Local Candidates stored: ", spec.localCandidates.length, spec.localCandidates);
            }

        } else {
            console.log("End of candidates.");
        }
    };

    var setVideoCodec = function(sdp){
        if (spec.videoCodec !== 'H264' && spec.videoCodec !== 'h264') {
            return sdp;
        }
        // Put H264 in front of VP8(120)
        try {
            var mLine = sdp.match(/m=video.*\r\n/g)[0];
            var newMLine = mLine.replace(/\s120/, '').replace('\r\n','') + ' 120\r\n';
            return sdp.replace(mLine, newMLine);
        } catch (e) {
            return sdp;
        }
    };

    var updateSdp = function(sdp) {
        var newSdp = setVideoCodec(sdp);
        // Add other operations here, e.g. set bandwidth.
        return newSdp;
    };

    that.peerConnection.onaddstream = function (stream) {
        if (that.onaddstream) {
            that.onaddstream(stream);
        }
    };

    that.peerConnection.onremovestream = function (stream) {
        if (that.onremovestream) {
            that.onremovestream(stream);
        }
    };

    that.peerConnection.oniceconnectionstatechange = function (e) {
        if (that.oniceconnectionstatechange) {
            that.oniceconnectionstatechange(e.currentTarget.iceConnectionState);
        }
    };

    var setMaxBW = function (sdp) {
        var a, r;
        if (spec.video && spec.maxVideoBW) {
            a = sdp.match(/m=video.*\r\n/);
            if (a == null){
              a = sdp.match(/m=video.*\n/);
            }
            if (a && (a.length > 0)) {
                r = a[0] + "b=AS:" + spec.maxVideoBW + "\r\n";
                sdp = sdp.replace(a[0], r);
            }
        }

        if (spec.audio && spec.maxAudioBW) {
            a = sdp.match(/m=audio.*\r\n/);
            if (a == null){
              a = sdp.match(/m=audio.*\n/);
            }
            if (a && (a.length > 0)) {
                r = a[0] + "b=AS:" + spec.maxAudioBW + "\r\n";
                sdp = sdp.replace(a[0], r);
            }
        }

        return sdp;
    };

    var localDesc;

    var setLocalDesc = function (sessionDescription) {
        sessionDescription.sdp = setMaxBW(sessionDescription.sdp);
        sessionDescription.sdp = updateSdp(sessionDescription.sdp.replace(/a=ice-options:google-ice\r\n/g, ''));
        spec.callback(sessionDescription);
        localDesc = sessionDescription;
    };

    var setLocalDescp2p = function (sessionDescription) {
        sessionDescription.sdp = setMaxBW(sessionDescription.sdp);
        sessionDescription.sdp = sessionDescription.sdp.replace(/a=ice-options:google-ice\r\n/g, "");
        spec.callback(sessionDescription);
        localDesc = sessionDescription;
        that.peerConnection.setLocalDescription(localDesc);
    };

    that.createOffer = function (isSubscribe) {
        if (isSubscribe === true) {
            that.peerConnection.createOffer(setLocalDesc, errorCallback, that.mediaConstraints);
        } else {
            that.peerConnection.createOffer(setLocalDesc, errorCallback);
        }
    };

    that.addStream = function (stream) {
        that.peerConnection.addStream(stream);
    };
    spec.remoteCandidates = [];
    spec.remoteDescriptionSet = false;

    /**
     * Closes the connection.
     */
    that.close = function () {
        that.state = 'closed';
        if (that.peerConnection.signalingState !== 'closed') {
            that.peerConnection.close();
        }
    };

    that.processSignalingMessage = function (msg) {

//      L.Logger.debug("Process Signaling Message", msg);

        if (msg.type === 'offer') {
            msg.sdp = setMaxBW(msg.sdp);
            that.peerConnection.setRemoteDescription(new RTCSessionDescription(msg), function(){
                that.peerConnection.createAnswer(setLocalDescp2p, function(error){
                L.Logger.error("Error", error);
            }, that.mediaConstraints);
                spec.remoteDescriptionSet = true;
            }, function(error){
              L.Logger.error("Error setting Remote Description", error);
            });
        } else if (msg.type === 'answer') {

            // // For compatibility with only audio in Firefox Revisar
            // if (answer.match(/a=ssrc:55543/)) {
            //     answer = answer.replace(/a=sendrecv\\r\\na=mid:video/, 'a=recvonly\\r\\na=mid:video');
            //     answer = answer.split('a=ssrc:55543')[0] + '"}';
            // }

            console.log("Set remote and local description", msg.sdp);

            msg.sdp = setMaxBW(msg.sdp);

            that.peerConnection.setLocalDescription(localDesc, function(){
                that.peerConnection.setRemoteDescription(new RTCSessionDescription(msg), function() {
                    spec.remoteDescriptionSet = true;
                    L.Logger.info("Remote Description successfully set");
                    while (spec.remoteCandidates.length > 0 && gotCandidate) {
                        L.Logger.info("Setting stored remote candidates");
                        // IMPORTANT: preserve ordering of candidates
                        that.peerConnection.addIceCandidate(spec.remoteCandidates.shift());
                    }
                    while(spec.localCandidates.length > 0) {
                        L.Logger.info("Sending Candidate from list");
                        // IMPORTANT: preserve ordering of candidates
                        spec.callback({type:'candidate', candidate: spec.localCandidates.shift()});
                    }
                }, function (error){
                    L.Logger.error("Error Setting Remote Description", error);
                });
            },function(error){
               L.Logger.error("Failure setting Local Description", error);
            });

        } else if (msg.type === 'candidate') {
            try {
                var obj;
                if (typeof(msg.candidate) === 'object') {
                    obj = msg.candidate;
                } else {
                    obj = JSON.parse(msg.candidate);
                }
                obj.candidate = obj.candidate.replace(/ generation 0/g, "");
                obj.candidate = obj.candidate.replace(/ udp /g, " UDP ");
                obj.sdpMLineIndex = parseInt(obj.sdpMLineIndex, 10);
                var candidate = new RTCIceCandidate(obj);
//              L.Logger.debug("Remote Candidate",candidate);
                if (spec.remoteDescriptionSet && gotCandidate) {
                    that.peerConnection.addIceCandidate(candidate);
                    while (spec.remoteCandidates.length > 0) {
                        L.Logger.info("Setting stored remote candidates");
                        // IMPORTANT: preserve ordering of candidates
                        that.peerConnection.addIceCandidate(spec.remoteCandidates.shift());
                    }
                } else {
                    spec.remoteCandidates.push(candidate);
                }
            } catch(e) {
                L.Logger.error("Error parsing candidate", msg.candidate, e);
            }
        }
    };
    return that;
};