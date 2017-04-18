(function(global) {
  "use strict";

  var START_PATH = '/a/pushItem/';
  var WAIT_PATH = '/a/itemInfo/';
  var ORIGIN = 'http://www.youtube-mp3.org';
  var API_URL = 'http://gdata.youtube.com/feeds/api/videos/';

  var getVideoUrl = function(id) {
    return 'https://youtube.com/watch?v=' + id;
  };

  var copy = function(source, target) {
    target || (target = {});

    Object.keys(source).forEach(function(key) {
      target[key] = source[key];
    });

    return target;
  };

  var createRequest = function(url) {
    var xhr = new XMLHttpRequest();

    xhr.open('GET', ORIGIN + url, true);
    xhr.responseType = 'text';

    setHeaders(xhr);

    return xhr;
  };

  var getError = function(response) {
    var error;

    if (
      response.indexOf('pushItemYTError') === 0 ||
      response === '$$$ERROR$$$'
    ) {
      error = {
        type: 'SERVER_REJECTED',
        reason: 'ERROR'
      };
    } else if (response === '$$$LIMIT$$$') {
      error = {
        type: 'SERVER_REJECTED',
        reason: 'LIMIT_ERROR'
      };
    } else if (this.status >= 400) {
      error = {
        type: 'HTTP_ERROR',
        status: this.status,
        text: this.statusText
      };
    }

    return error;
  };

  var extractInfo = function(response) {
    response = response
      .replace(/^\s*info\s*=\s*/i, '')
      .replace(/;/g, '');

    return JSON.parse(response);
  };

  var YoutubeMP3 = {
    startDownload: function(videoId, id) {
      var url = START_PATH + [
        '?item=' + escape(getVideoUrl(videoId)),
        '&el=na&bf=false',
        '&r=' + Date.now()
      ].join('');

      url = sig_url(url);

      var xhr = createRequest(url);

      return new Promise(function(resolve, reject) {
        xhr.onload = function() {
          // '$$$ERROR$$$'
          // '$$$LIMIT$$$'
          // 400 < h.status && 600 > h.status

          var response = xhr.response;
          var error = getError.call(xhr, response);

          if (error) {
            reject(error);
          } else {
            resolve({
              id: id,
              videoId: videoId,
              responseId: response
            });
          }
        };

        xhr.onerror = function() {
          var error = {
            type: 'NETWORK_ERROR'
          };

          reject(error);
        };

        xhr.send();
      });
    },
    waitEnd: function(data) {
      var responseId = data.responseId;

      var url = WAIT_PATH + [
        '?video_id=' + responseId,
        '&ac=www&t=grp',
        '&r=' + Date.now()
      ].join('');

      url = sig_url(url);

      var xhr = createRequest(url);

      return new Promise(function(resolve, reject) {
        xhr.onload = function() {

          var response = xhr.response;
          var error = getError.call(xhr, response);

          if (error) {
            reject(error);
            return;
          }

          try {
            response = extractInfo(response);

            resolve({
              info: response,
              id: data.id,
              videoId: data.videoId,
              responseId: data.responseId
            });
          } catch (e) {
            error = {
              type: 'CLIENT_ERROR',
              reason: 'PARSE_ERROR'
            };

            reject(e);
          }
        };

        xhr.onerror = function() {
          var error = {
            type: 'NETWORK_ERROR'
          };

          reject(error);
        };

        xhr.send();
      }).then(function(response) {
        return YoutubeMP3.checkInfo(response);
      });
    },
    download: function(videoId) {
      var id = Date.now() + Math.random();
      var start = YoutubeMP3.startDownload(videoId, id);
      var promise = start.then(function(response) {
        return YoutubeMP3.waitEnd(response);
      }).catch(function(error) {
        if (error instanceof Error) {
          error = {
            type: 'SCRIPT_ERROR',
            error: error
          };
        }

        throw error;
      });

      return {
        id: id,
        promise: promise
      };
    },
    checkInfo: function(data) {
      var info = data.info;
      var responseId = data.responseId;

      this.fireEvent(copy(data));

      if (info.status === 'captcha') {
        var error = {
          type: 'CAPTCHA',
          data: data
        };

        return Promise.reject(error);
      } else if (info.status === 'serving') {
        return Promise.resolve(data);
      } else if (info.status === 'pending') {
        // return YoutubeMP3.waitEnd(responseId);
      } else if (info.status === 'converting') {
        // return YoutubeMP3.waitEnd(responseId);
      } else if (info.status === 'loooooo') {

      }

      return new Promise(function(resolve) {
        setTimeout(function() {
          resolve();
        }, 5000)
      }).then(function() {
        return YoutubeMP3.waitEnd(data);
      });
    },
    getMetaData: function(videoId) {
      var url = API_URL + videoId + '?alt=jsonc&v=2';
      var xhr = new XMLHttpRequest();

      xhr.open('GET', url, true);
      xhr.responseType = 'json';

      var req = {
        abort: function() {
          xhr.abort();
        },
        promise: new Promise(function(resolve, reject) {
          xhr.onload = function() {
            if (xhr.status > 400 || !xhr.status) {
              reject(xhr);
            } else {
              resolve(this.response);
            }
          };

          xhr.onerror = function() {
            reject(xhr);
          };

          xhr.onloadend = function() {
            req.abort = function() {};
          };

          xhr.send();
        })
      };

      return req;
    },
    getDownloadUrl: function(responseId, info) {
      var url = [
        '/get?video_id=' + responseId,
        '&ts_create=' + info.ts_create,
        '&r=' + encodeURIComponent(info.r),
        '&h2=' + info.h2
      ].join('');

      url = ORIGIN + sig_url(url);

      return url;
    },

    listenersMap: new Map(),
    eventTarget: document.createElement('youtube-mp3'),
    UPDATE_EVENT: 'youtube-mp3:update',

    addListener: function(listener) {
      var handler = function(e) {
        listener.call(YoutubeMP3, e.detail);
      };

      this.listenersMap.set(listener, handler);
      this.eventTarget.addEventListener(this.UPDATE_EVENT, handler);
    },
    removeListener: function(listener) {
      var handler = this.listenersMap.get(listener);

      if (handler) {
        this.listenersMap.delete(listener);
        this.eventTarget.removeEventListener(this.UPDATE_EVENT, handler);
      }
    },
    fireEvent: function(data) {
      var event = new CustomEvent(this.UPDATE_EVENT, {
        detail: data
      });

      this.eventTarget.dispatchEvent(event);
    }
  };

  var setHeaders = function(xhr) {
    try {
      xhr.setRequestHeader("Accept-Location", "*");
      xhr.setRequestHeader("Cache-Control", "no-cache");
    } catch (e) {}
  };

  var sig = function(a) {
      if ("function" == typeof _sig) {
          var b = "X";
          try {
              b = _sig(a)
          } catch (c) {}
          if ("X" != b) return b
      }
      return "-1"
  };
  var sig_url = window.sig_url = function(a) {
      var b = sig(a);
      return a + "&s=" + escape(b)
  };

  var b0I = {
    'V': function(I, B, P) {
        return I * B * P;
    },
    'D': function(I, B) {
        return I < B;
    },
    'E': function(I, B) {
        return I == B;
    },
    'B3': function(I, B) {
        return I * B;
    },
    'G': function(I, B) {
        return I < B;
    },
    'v3': function(I, B) {
        return I * B;
    },
    'I3': function(I, B) {
        return I in B;
    },
    'C': function(I, B) {
        return I % B;
    },
    'R3': function(I, B) {
        return I * B;
    },
    'O': function(I, B) {
        return I % B;
    },
    'Z': function(I, B) {
        return I < B;
    },
    'K': function(I, B) {
        return I - B;
    }
  };

  var _sig = function(H) {
      var U = "R3",
          m3 = "round",
          e3 = "B3",
          D3 = "v3",
          N3 = "I3",
          g3 = "V",
          K3 = "toLowerCase",
          n3 = "substr",
          z3 = "Z",
          d3 = "C",
          P3 = "O",
          x3 = ['a', 'c', 'e', 'i', 'h', 'm', 'l', 'o', 'n', 's', 't', '.'],
          G3 = [6, 7, 1, 0, 10, 3, 7, 8, 11, 4, 7, 9, 10, 8, 0, 5, 2],
          M = ['a', 'c', 'b', 'e', 'd', 'g', 'm', '-', 's', 'o', '.', 'p', '3', 'r', 'u', 't', 'v', 'y', 'n'],
          X = [
              [17, 9, 14, 15, 14, 2, 3, 7, 6, 11, 12, 10, 9, 13, 5],
              [11, 6, 4, 1, 9, 18, 16, 10, 0, 11, 11, 8, 11, 9, 15, 10, 1, 9, 6]
          ],
          A = {
              "a": 870,
              "b": 906,
              "c": 167,
              "d": 119,
              "e": 130,
              "f": 899,
              "g": 248,
              "h": 123,
              "i": 627,
              "j": 706,
              "k": 694,
              "l": 421,
              "m": 214,
              "n": 561,
              "o": 819,
              "p": 925,
              "q": 857,
              "r": 539,
              "s": 898,
              "t": 866,
              "u": 433,
              "v": 299,
              "w": 137,
              "x": 285,
              "y": 613,
              "z": 635,
              "_": 638,
              "&": 639,
              "-": 880,
              "/": 687,
              "=": 721
          },
          r3 = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

      var gs = function(I, B) {
          var P = "D",
              J = "";
          for (var R = 0; b0I[P](R, I.length); R++) {
              J += B[I[R]];
          };
          return J;
      };
      var ew = function(I, B) {
          var P = "K",
              J = "indexOf";
          return I[J](B, b0I[P](I.length, B.length)) !== -1;
      };
      var gh = function() {
          var I = gs(G3, x3);

          return I === 'location.hostname' ? 'www.youtube-mp3.org' : I.split('.').reduce(function(result, key) {
            if (!result) return result;

            return result[key];
          }, window);
      };
      var fn = function(I, B) {
          var P = "E",
              J = "G";
          for (var R = 0; b0I[J](R, I.length); R++) {
              if (b0I[P](I[R], B)) return R;
          }
          return -1;
      };
      var L = [1.23413, 1.51214, 1.9141741, 1.5123114, 1.51214, 1.2651],
          F = 1;
      try {
          F = L[b0I[P3](1, 2)];
          var W = gh(),
              S = gs(X[0], M),
              T = gs(X[1], M);
          if (ew(W, S) || ew(W, T)) {
              F = L[1];
          } else {
              F = L[b0I[d3](5, 3)];
          }
      } catch (I) {};
      var N = 3219;
      for (var Y = 0; b0I[z3](Y, H.length); Y++) {
          var Q = H[n3](Y, 1)[K3]();
          if (fn(r3, Q) > -1) {
              N = N + (b0I[g3](parseInt(Q), 121, F));
          } else {
              if (b0I[N3](Q, A)) {
                  N = N + (b0I[D3](A[Q], F));
              }
          }
          N = b0I[e3](N, 0.1);
      }
      N = Math[m3](b0I[U](N, 1000));
      return N;
  };

  var __AM = 65521;

  var _cc = function(a) {
      if ("string" != typeof a) throw Error("se");

      var b = 1,
          c = 0,
          d, e;

      for (e = 0; e < a.length; e++) d = a.charCodeAt(e), b = (b + d) % __AM, c = (c + b) % __AM;

      return c << 16 | b
  };

  var cc = function(a) {
    try {
      return _cc(a)
    } catch (b) {}

    return 0
  };

  global.YoutubeMP3 = YoutubeMP3;
}(this));