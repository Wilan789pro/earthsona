(
s.waitForBoot {
    var path, buffer;

    path = "D:/AstroNopes/triangle-sound.wav";

    if(File.exists(path).not) {
        ("FILE NOT FOUND: " ++ path).error;
    } {
        buffer = Buffer.read(s, path);
        s.sync;

        if((buffer.numFrames ? 0) <= 0) {
            "Audio loading failed. Please check the WAV file.".error;
            buffer.free;
        } {
            SynthDef(\climateOverlapSound, {
                |out = 0, bufnum = 0, pitchRatio = 1, amplitude = 0.25|

                var source, shifted, envelope, totalDuration;

                // Read the recording once, at its original speed.
                source = PlayBuf.ar(
                    numChannels: buffer.numChannels,
                    bufnum: bufnum,
                    rate: BufRateScale.kr(bufnum),
                    loop: 0,
                    doneAction: 0
                );

                // Change pitch independently of playback speed.
                shifted = PitchShift.ar(
                    source,
                    windowSize: 0.1,
                    pitchRatio: pitchRatio,
                    pitchDispersion: 0,
                    timeDispersion: 0
                );

                // Allow the pitch-shifter's tail to finish.
                totalDuration = BufDur.kr(bufnum) + 0.15;

                envelope = EnvGen.kr(
                    Env.linen(
                        attackTime: 0.005,
                        sustainTime: (totalDuration - 0.015).max(0.001),
                        releaseTime: 0.01
                    ),
                    doneAction: 2
                );

                Out.ar(out, shifted * envelope * amplitude);
            }).add;

            s.sync;

            {
                var window, temperatureSlider, temperatureBox;
                var windSlider, windBox, referenceButton;
                var temperatureLabel, windLabel, mappingLabel;
                var statusLabel, countdownLabel;
                var temperature, wind, referenceRequested;
                var pitchFor, repeatsFor, updateControls;
                var soundGroup, player;
                var minRepeats, maxRepeats;

                temperature = 20;
                wind = 30;
                referenceRequested = false;

                // Number of sound starts per second.
                minRepeats = 0.25;
                maxRepeats = 3.0;

                soundGroup = Group(s);

                // Temperature -> pitch.
                // -10 C = one octave down.
                //  20 C = original pitch.
                //  40 C = one octave up.
                pitchFor = { |temp|
                    var semitones;

                    semitones = if(temp <= 20) {
                        temp.linlin(-10, 20, -12, 0)
                    } {
                        temp.linlin(20, 40, 0, 12)
                    };

                    semitones.midiratio;
                };

                // Wind -> sound starts per second.
                repeatsFor = { |speed|
                    speed.clip(0, 100).linlin(
                        0, 100, minRepeats, maxRepeats
                    );
                };

                window = Window(
                    "Climate Sound Explorer - Overlapping Playback",
                    Rect(200, 150, 660, 450)
                );

                window.alwaysOnTop_(true);

                StaticText(window, Rect(20, 15, 620, 25))
                    .string_(
                        "Temperature = pitch | Wind = sounds per second"
                    );

                temperatureLabel = StaticText(
                    window, Rect(20, 55, 620, 25)
                );

                temperatureSlider = Slider(
                    window, Rect(20, 85, 480, 30)
                );

                temperatureBox = NumberBox(
                    window, Rect(515, 85, 120, 30)
                )
                    .clipLo_(-10)
                    .clipHi_(40)
                    .decimals_(1);

                windLabel = StaticText(
                    window, Rect(20, 140, 620, 25)
                );

                windSlider = Slider(
                    window, Rect(20, 170, 480, 30)
                );

                windBox = NumberBox(
                    window, Rect(515, 170, 120, 30)
                )
                    .clipLo_(0)
                    .clipHi_(100)
                    .decimals_(1);

                mappingLabel = StaticText(
                    window, Rect(20, 215, 620, 25)
                );

                referenceButton = Button(
                    window, Rect(20, 255, 330, 35)
                ).states_([
                    ["Play reference: 20 C"]
                ]);

                statusLabel = StaticText(
                    window, Rect(20, 310, 620, 25)
                );

                countdownLabel = StaticText(
                    window, Rect(20, 340, 620, 25)
                );

                StaticText(window, Rect(20, 380, 620, 25))
                    .string_(
                        "Overlap enabled. Maximum: 1.75 sound starts per second."
                    );

                StaticText(window, Rect(20, 410, 620, 25))
                    .string_(
                        "Settings apply at the next start. Close the window to stop."
                    );

                updateControls = {
                    var repeats;

                    repeats = repeatsFor.value(wind);

                    temperatureSlider.value_(
                        temperature.linlin(-10, 40, 0, 1)
                    );
                    temperatureBox.value_(temperature);

                    windSlider.value_(wind / 100);
                    windBox.value_(wind);

                    temperatureLabel.string_(
                        "Temperature: "
                        ++ temperature.round(0.1)
                        ++ " C     (colder = deeper, warmer = higher)"
                    );

                    windLabel.string_(
                        "Wind: "
                        ++ wind.round(0.1)
                        ++ " km/h     (stronger = more frequent sounds)"
                    );

                    mappingLabel.string_(
                        "Pitch: "
                        ++ pitchFor.value(temperature).round(0.01)
                        ++ "x | "
                        ++ repeats.round(0.01)
                        ++ " sounds/sec | Interval: "
                        ++ (1 / repeats).round(0.001)
                        ++ " sec"
                    );
                };

                temperatureSlider.action_({ |control|
                    temperature = control.value.linlin(
                        0, 1, -10, 40
                    ).round(0.1);

                    updateControls.value;
                });

                temperatureBox.action_({ |control|
                    temperature = control.value.clip(-10, 40);
                    updateControls.value;
                });

                windSlider.action_({ |control|
                    wind = (control.value * 100).round(0.1);
                    updateControls.value;
                });

                windBox.action_({ |control|
                    wind = control.value.clip(0, 100);
                    updateControls.value;
                });

                // Replace the next scheduled sound with a reference.
                // Existing sounds are allowed to finish.
                referenceButton.action_({
                    referenceRequested = true;

                    referenceButton.states_([
                        ["Reference queued for next playback"]
                    ]);
                });

                // AppClock lets this routine update the interface.
                player = Routine({
                    var nextStart;

                    nextStart = Main.elapsedTime;

                    loop {
                        var isReference, playedTemperature;
                        var ratio, repeats, interval, remaining;

                        isReference = referenceRequested;
                        referenceRequested = false;

                        playedTemperature = if(isReference) {
                            20
                        } {
                            temperature
                        };

                        ratio = pitchFor.value(playedTemperature);
                        repeats = repeatsFor.value(wind);
                        interval = 1 / repeats;

                        referenceButton.states_([
                            ["Play reference: 20 C"]
                        ]);

                        statusLabel.string_(
                            if(isReference) {
                                "Starting REFERENCE: 20 C"
                            } {
                                "Starting sound: "
                                ++ playedTemperature.round(0.1)
                                ++ " C | "
                                ++ repeats.round(0.01)
                                ++ " sounds/sec"
                            }
                        );

                        // Every playback has its own synth.
                        // Earlier sounds continue until they finish.
                        Synth(\climateOverlapSound, [
                            \bufnum, buffer.bufnum,
                            \pitchRatio, ratio,
                            \amplitude, 0.25
                        ], soundGroup);

                        // Schedule from sound START, not sound END.
                        nextStart = nextStart + interval;

                        // Avoid catch-up bursts after a GUI stall.
                        if(nextStart < Main.elapsedTime) {
                            nextStart = Main.elapsedTime + interval;
                        };

                        while {
                            Main.elapsedTime < nextStart
                        } {
                            remaining = (
                                nextStart - Main.elapsedTime
                            ).max(0);

                            countdownLabel.string_(
                                "Next sound starts in "
                                ++ remaining.round(0.1)
                                ++ " seconds"
                            );

                            remaining.min(0.05).max(0.001).wait;
                        };
                    };
                });

                window.onClose_({
                    player.stop;
                    soundGroup.free;
                    buffer.free;
                });

                updateControls.value;
                window.front;
                player.play(AppClock);
            }.defer;
        };
    };
};
)