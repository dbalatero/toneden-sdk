define(['jquery', 'vendor/simple-slider', 'underscore', 'vendor/sc-interface', 'vendor/handlebars', 'hbs!templates/player', 'hbs!templates/player-solo', 'hbs!templates/player-mini', 'hbs!templates/player-empty', 'templates/helpers/msToTimestamp', 'vendor/d3'], function($, SimpleSlider, _, scPlayer, Handlebars, template, template_solo, template_mini, template_empty, msToTimestamp, d3) {
    return {
        create: function(urls, dom, options) {
            ToneDen.players = ToneDen.players || [];

            var player;
            var playerVolume=100;
            var repeat;

            // Default parameters go here.
            var parameters = {
                debug: false, // Output debug messages?
                keyboardEvents: false, // Should we listen to keyboard events?
                single: null,
                skin: 'light',
                staticUrl: '//sd.toneden.io/',
                tracksPerArtist: 10, // How many tracks to load when given an artist SoundCloud URL.
                visualizer: true,
                visualizerType: 'waves', // Equalizer type. 'waves' or 'bars'
                mini: false
            };

            // Setup the parameters object with the given arguments and
            // override the default parameters with the given options.
            if(arguments.length === 1 && typeof arguments[0] === 'object') {
                _.extend(parameters, arguments[0]);
            } else {
                parameters.urls = urls;
                parameters.dom = dom;

                delete options.urls;
                delete options.dom;

                _.extend(parameters, options);

                if(parameters.staticUrl.charAt(parameters.staticUrl.length - 1) !== '/') {
                    parameters.staticUrl += '/';
                }
            }

            // Visualizer is currently only supported in Chrome.
            if(navigator.userAgent.toLowerCase().indexOf('chrome') === -1) {
                parameters.visualizer = false;
            }

            if(parameters.visualizerType === 'none') {
                parameters.visualizer = false;
            }

            // Parameters for the SoundCloud player.
            var playerParameters = {
                consumerKey: '6f85bdf51b0a19b7ab2df7b969233901',
                debug: parameters.debug,
                preload: true,
                togglePause: true,
                tracksPerArtist: parameters.tracksPerArtist,
                visualizer: parameters.visualizer
            }

            var dom = parameters.dom;
            var urls = parameters.urls;
            var container = $(dom);
            var currentRatio = null;
            var currentTimeIn = null;
            var bufferPauseThreshold = 5000; // If the track plays within this many milliseconds of the buffer edge, pause and wait.
            var bufferResumeThreshold = 10000; // Once the buffer is this var past the play progress, it will resume.
            var trackLoadedPercent = null;
            var trackLoadedTime = null;
            var trackPlayedPercent = null;
            var trackReady = false;
            var trackSuspend = false;

            var scInstance = new scPlayer(urls, playerParameters);
            var titleArea = container.find('.title');

            // Helper functions.
            function log(message, level) {
                // Level can be debug or error.
                if(window.console) {
                    if(level === 'error') {
                        console.error(message);
                    } else if(parameters.debug) {
                        console.debug(message);
                    }
                }
            }

            function rerender(parameters) {
                parameters = JSON.parse(JSON.stringify(parameters));

                var empty = !_.any(parameters.tracks) && parameters.tracks.length > 0;

                if(parameters.nowPlaying) {
                    for(var i = 0; i < parameters.tracks.length; i++) {
                        if(parameters.tracks[i].title === parameters.nowPlaying.title) {
                            parameters.tracks[i].playing = true;
                        }
                    }
                }

                if(empty) {
                    container.html(template_empty(parameters));
                } else if(parameters.single == true) {
                    container.html(template_solo(parameters));
                    modifyVolumeUI();

                    //container responsiveness
                    if(parameters.tracks.length>1){
                        container.find(".prev").show();
                        container.find(".next").show();
                    } else {
                        container.find(".prev").hide();
                        container.find(".next").hide();
                    }

                    if(container.width()<500) {
                        container.find(".header").addClass("header-small").css("width", "100%");
                        container.find(".solo-container").addClass("solo-container-small").css("width", "100%").prependTo(container.find(".solo-buttons"));
                        container.find(".scrubber").hide();
                    }
                } else if(parameters.mini==true) {
                    container.html(template_mini(parameters));
                } else {
                    container.html(template(parameters));
                    modifyVolumeUI();

                    //container responsiveness
                    if(container.width()<500) {
                        container.find(".current-song-info").css("width", "100%").prependTo(container.find(".social"));
                        container.find(".buy").hide();
                        container.find(".follow").hide();
                        container.find(".track-info-stats").hide();
                    }

                    if(container.height()<500) {
                        container.find(".player").addClass("shrink");
                    }
                }

                container.find('.scrubber-slider').simpleSlider({
                    highlight: true
                });
            }

            function drawEQ(data) {
                if(!data) {
                    var data = [];

                    for(var i = 0; i < 128; i++) {
                        data.push(0);
                    }
                }

                var d3Container = d3.select(container[0]);
                var chart = d3Container.select('.waveform svg');

                var n = 128;
                 
                var margin = {
                    top: 0,
                    right: 0,
                    bottom: 0,
                    left: 0
                };

                var width = container.find('.cover').width();
                var height = container.find('.cover').height();
                var barWidth = (width - n) / n;
                 
                var x = d3.scale.linear()
                    .domain([0, n - 1])
                    .range([0, width]);
                 
                var y = d3.scale.linear()
                    .domain([0, 1.5])
                    .range([0, height]);

                var line = d3.svg.line()
                    .x(function(d, i) {
                        return x(i);
                    })
                    .y(function(d, i) {
                        return height - y(d);
                    })
                    .interpolate('basis');

                if(!chart.node()) {
                    chart = d3Container.select('.waveform').append('svg:svg')
                        .attr('width', width + margin.left + margin.right)
                        .attr('height', height + margin.top + margin.bottom)
                        .append('g');

                    if(parameters.visualizerType == 'waves'){
                        chart.selectAll('path')
                            .data([data])
                            .enter()
                            .append('svg:path')
                            .attr('d', line)
                            .attr('stroke-width', 3);
                    } else if(parameters.visualizerType == 'bars') {
                        chart.selectAll('rect')
                            .data(data)
                            .enter().append('rect')
                            .attr('x', function(d, i) {
                                return x(i);
                            })
                            .attr('y', function(d) {
                                return height - y(d);
                            })
                            .attr('width', barWidth)
                            .attr('height', function(d) {
                                return y(d);
                            });
                    }                
                }

                function redrawEQ(svg, data) {
                    if(parameters.visualizerType === 'waves') {
                        svg.selectAll('path')
                            .data([data])
                            .attr('d', line)
                            .transition()
                                .ease('linear')
                                .duration(100);
                    } else if(parameters.visualizerType == 'bars') {
                        chart.selectAll('rect')
                            .data(data)
                            .transition()
                            .duration(100)
                            .attr('y', function(d) {
                                return height - y(d);
                            })
                            .attr('height', function(d) {
                                return y(d);
                            });
                    }
                }

                redrawEQ(chart, data);
            }

            //TODO: Refactor
            function modifyVolumeUI() {
                console.log(playerVolume);
                if(playerVolume==100) {
                    container.find(".volume-init").removeClass().addClass("fa fa-volume-up fw volume-init");
                    container.find(".volume-select i.volume-active").removeClass("volume-active");
                    container.find(".volume-select i.volume-max").addClass("volume-active");
                } else if(playerVolume==0) {
                    container.find(".volume-init").removeClass().addClass("fa fa-volume-off fw volume-init");
                    container.find(".volume-select i.volume-active").removeClass("volume-active");
                    container.find(".volume-select i.volume-off").addClass("volume-active");
                } else {
                    container.find(".volume-init").removeClass().addClass("fa fa-volume-down fw volume-init");
                    container.find(".volume-select i.volume-active").removeClass("volume-active");
                    container.find(".volume-select i.volume-med").addClass("volume-active");
                }
            }

            function changePlayButton(paused) {
                var playClass = 'fa-play-circle-o';
                var pauseClass = 'fa-pause';
                var playButton = container.find('.play');

                if(paused) {
                    playButton.removeClass(pauseClass);
                    playButton.addClass(playClass);
                } else {
                    playButton.removeClass(playClass);
                    playButton.addClass(pauseClass);
                }
            }

            // Make sure the specified container is valid.
            if(container.length > 0) {
                rerender({
                    tracks: [],
                    skin: parameters.skin,
                    eq: parameters.eq,
                    tracksPerArtist: parameters.tracksPerArtist,
                    single: parameters.single,
                    mini: parameters.mini
                });
            } else {
                log('ToneDen Player: the container specified by "' + parameters.dom + '" does not exist.', 'error');
                return;
            }
            // Set up listeners for dom elements.
            container.on('click', '.controls', function(e) {
                e.preventDefault();
                var target = $(e.target);

                if(target.hasClass('play')) {
                    scInstance.pause();
                } else if(target.hasClass('next')) {
                    scInstance.next();
                } else if(target.hasClass('prev')) {
                    if(scInstance.position() > 5) {
                        scInstance.seek(0);
                    }
                    else {
                        scInstance.prev();
                    }
                }
            });

            container.on('click', '.repeat-init', function(e) {
                e.preventDefault();
                var target = $(e.target);

                if(target.hasClass('repeat-on')) {
                    target.removeClass("repeat-on");
                    repeat = false;
                    scInstance.loopTrack = false;
                } else {
                    target.addClass("repeat-on");
                    repeat = true;
                    scInstance.loopTrack = true;
                }
            });

            container.on('click', '.volume-controls', function(e) {
                e.preventDefault();
                var target = $(e.target);
                var newClass = target.attr("data-class");

                if(target.hasClass('volume-init')) {
                    container.find(".volume-init").hide();
                    container.find(".volume-select").fadeIn();
                }else if(target.hasClass('volume-off')) {
                    scInstance.volume(0);
                    container.find(".volume-select i").removeClass('volume-active');
                    target.addClass('volume-active');
                    container.find(".volume-init").fadeIn().removeClass().addClass(newClass + " volume-init");
                    container.find(".volume-select").hide();
                    playerVolume = 0;
                } else if(target.hasClass('volume-med')) {
                    scInstance.volume(50);
                    container.find(".volume-select i").removeClass('volume-active');
                    target.addClass('volume-active');
                    container.find(".volume-init").fadeIn().removeClass().addClass(newClass + " volume-init");
                    container.find(".volume-select").hide();
                    playerVolume = 50;
                } else if(target.hasClass('volume-max')) {
                    scInstance.volume(100);
                    container.find(".volume-select i").removeClass('volume-active');
                    target.addClass('volume-active');
                    container.find(".volume-init").fadeIn().removeClass().addClass(newClass + " volume-init");
                    container.find(".volume-select").hide();
                    playerVolume = 50;
                }
            });

            container.on('click', '.track-info', function(e) {
                var row = $(this);
                var cls = row.attr('class');
                var index = Number(row.attr('data-index'));

                if(cls.indexOf('playing') === -1) {
                    scInstance.goto(index);
                }
            });

            container.on('slider:changed', '.scrubber-slider', function(e, slider) {
                scInstance.play();
                log('Slider Ratio: ' + slider.ratio);
                
                scInstance.seek(slider.ratio);
            });

            // Document-wide listeners.
            if(parameters.keyboardEvents) {
                document.addEventListener('keydown', function(e) {
                    if (e.keyCode == 32) {
                        if(scInstance) {
                            scInstance.pause();
                        }

                        e.preventDefault();
                    } else if (e.keyCode == 39) {
                        if(scInstance) {
                            scInstance.next();
                        }

                        e.preventDefault();
                    } else if (e.keyCode == 37) {
                        if(scInstance) {
                            scInstance.prev();
                        }

                        e.preventDefault();
                    }
                }, false);
            }

            // Hook into SC player events.
            scInstance.on('scplayer.play', function(e) {
                changePlayButton(false);
            });

            scInstance.on('scplayer.pause', function(e) {
                var paused = scInstance.sound().paused;

                changePlayButton(paused);
            });

            scInstance.on('scplayer.stop', function(e) {
                log('Stopped.');
                container.find('.play').attr('src', parameters.staticUrl + 'img/play.png');
            });

            scInstance.on('scplayer.track.whileloading', function(e, percent) {
                trackLoadedPercent = percent;
                trackLoadedTime = percent / 100 * scInstance.sound().duration;

                container.find('.buffer').css('width', percent + '%');

                if(trackSuspend && (trackLoadedTime - scInstance.position()) > bufferResumeThreshold) {
                    scInstance.pause();

                    trackSuspend = false;
                }
            });

            scInstance.on('scplayer.track.whileplaying', function(e, percent, eqData) {
                if(parameters.visualizer == true && typeof(eqData[0]) === 'number' && !isNaN(eqData[0])) {
                    drawEQ(eqData);
                }

                var ratio = percent / 100;
                var playPosition = scInstance.position();
                var timeIn = msToTimestamp(playPosition);
                var timeLeft = msToTimestamp(scInstance.track().duration - playPosition);

                trackPlayedPercent = Math.round(percent);

                // Round ratio to the nearest 3 decimal points.
                ratio = ratio.toFixed(3);

                // Only update the slider if the ratio has changed.
                if(ratio !== currentRatio) {
                    container.find('.scrubber-slider').simpleSlider('setRatio', ratio, true);
                }

                // Only update the play times if they have changed.
                if(timeIn !== currentTimeIn) {
                    container.find('.start-time').html(timeIn);
                    container.find('.stop-time').html(timeLeft);
                }

                currentRatio = ratio;
                currentTimeIn = timeIn;

                var waitToBuffer = (trackLoadedTime - playPosition) < bufferPauseThreshold &&
                    timeLeft > bufferPauseThreshold || !eqData || (trackLoadedPercent / 100) < currentRatio;

                if(waitToBuffer) {
                    var loader = $('<i class="fa fw fa-spinner fa-spin tdloader"></i>');

                    if(trackPlayedPercent != 100) {
                        scInstance.pause();
                        trackSuspend = true;
                        container.find('.stop-time').empty().append(loader);
                    }
                }
            });

            scInstance.on('scplayer.playlist.preloaded', function(e) {
                log('All tracks loaded.');

                scInstance.tracks(function(tracks) {
                    var nowPlaying = scInstance.track();

                    log(tracks);

                    // If parameters.single is not explicitly set to false and
                    // there is only one track, render the single-track player.
                    if(tracks.length === 1 && parameters.single !== false && parameters.mini == false) {
                       parameters.single = true;
                    }

                    container.find('.tdspinner').hide();

                    rerender({
                        nowPlaying: nowPlaying,
                        tracks: tracks,
                        skin: parameters.skin,
                        tracksPerArtist: parameters.tracksPerArtist,
                        visualizerType: parameters.visualizerType,
                        single: parameters.single,
                        mini: parameters.mini
                    });
                });
            });

            scInstance.on('scplayer.track.ready', function(e) {
                trackReady = true;
            });

            scInstance.on('scplayer.changing_track', function(e, trackIndex) {
                log('New track index: ' + trackIndex);

                container.find('.played').css('width', '0%');
                container.find('.buffer').css('width', '0%');

                scInstance.tracks(function(tracks) {
                    rerender({
                        nowPlaying: scInstance.track(),
                        tracks: tracks,
                        skin: parameters.skin,
                        tracksPerArtist: parameters.tracksPerArtist,
                        visualizerType: parameters.visualizerType,
                        single: parameters.single,
                        mini: parameters.mini
                    });
                });
            });

            // Public methods that will be accessible on the player object.
            function destroy() {
                container.off();
                container.html('');

                scInstance.destroy();

                ToneDen.players.splice(ToneDen.players.indexOf(player), 1);
                delete player;
            }

            function pause() {
                scInstance.pause();
            }

            function play() {
                scInstance.play();
            }

            player = {
                destroy: destroy,
                pause: pause,
                parameters: parameters,
                play: play
            };

            ToneDen.players.push(player);

            return player;
        },
        /**
         * Returns the first player whose dom parameter matches the dom argument.
         */
        getInstanceByDom: function(dom) {
            if(!ToneDen.players) {
                return;
            }

            var testPlayer;

            for(var i = 0; i < ToneDen.players.length; i++) {
                testPlayer = ToneDen.players[i];

                if(typeof dom === 'string') {
                    if(testPlayer.parameters.dom === dom) {
                        return testPlayer;
                    }
                } else if(dom instanceof $) {
                    if($(testPlayer.parameters.dom).is(dom)) {
                        return testPlayer;
                    }
                }
            }
        }
    };
});
