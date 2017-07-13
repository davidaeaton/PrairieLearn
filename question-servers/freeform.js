var ERR = require('async-stacktrace');
var async = require('async');
var _ = require('lodash');
var fs = require('fs');
var path = require('path');
var child_process = require('child_process');
var handlebars = require('handlebars');
var cheerio = require('cheerio');

var elements = require('./elements');

module.exports = {
    elementFunction: function(fcn, elementName, jsArgs, pythonArgs, callback) {
        if (!elements.has(elementName)) {
            return callback(null, 'ERROR: invalid element name: ' + elementName);
        }
        const elementModule = elements.get(elementName);
        if (_.isString(elementModule)) {
            // python module
            const pythonFile = elementModule.replace(/\.[pP][yY]$/, '');
            const pythonCwd = path.join(__dirname, 'elements');
            this.execPython(pythonFile, fcn, pythonArgs, pythonCwd, (err, ret) => {
                if (ERR(err, callback)) return;
                callback(null, ret);
            });
        } else {
            // JS module
            elementModule[fcn](...jsArgs, (err, ret) => {
                if (ERR(err, callback)) return;
                callback(null, ret);
            });
        }
    },

    elementPrepare: function(elementName, $, element, variant_seed, index, question_data, callback) {
        const jsArgs = [$, element, variant_seed, index, question_data];
        const pythonArgs = [$(element).html(), index, variant_seed, question_data];
        this.elementFunction('prepare', elementName, jsArgs, pythonArgs, (err, html) => {
            if (ERR(err, callback)) return;
            callback(null, html);
        });
    },

    elementRender: function(elementName, $, element, index, question_data, callback) {
        const jsArgs = [$, element, index, question_data];
        const pythonArgs = [$(element).html(), index, question_data];
        this.elementFunction('render', elementName, jsArgs, pythonArgs, (err, html) => {
            if (ERR(err, callback)) return;
            callback(null, html);
        });
    },

    elementGrade: function(elementName, name, question_data, question, course, callback) {
        const jsArgs = [name, question_data, question, course];
        const pythonArgs = [name, question_data, question, course];
        this.elementFunction('grade', elementName, jsArgs, pythonArgs, (err, html) => {
            if (ERR(err, callback)) return;
            callback(null, html);
        });
    },

    renderExtraHeaders: function(question, course, locals, callback) {
        callback(null, '');
    },

    renderFile: function(filename, variant, question, submission, course, locals, callback) {
        var question_data = {
            params: variant.params,
            true_answer: variant.true_answer,
            options: variant.options,
            submitted_answer: submission ? submission.submitted_answer : null,
            feedback: submission ? submission.feedback : null,
            clientFilesQuestion: locals.paths.clientFilesQuestion,
            editable: locals.allowAnswerEditing,
        };
        this.execTemplate(filename, question_data, question, course, (err, question_data, html, $) => {
            if (ERR(err, callback)) return;

            let index = 0;
            async.eachSeries(elements.keys(), (elementName, callback) => {
                async.eachSeries($(elementName).toArray(), (element, callback) => {
                    this.elementRender(elementName, $, element, index, question_data, (err, elementHtml) => {
                        if (ERR(err, callback)) return;
                        $(element).replaceWith(elementHtml);
                        index++;
                        callback(null);
                    });
                }, (err) => {
                    if (ERR(err, callback)) return;
                    callback(null);
                });
            }, (err) => {
                if (ERR(err, callback)) return;
                callback(null, $.html());
            });
        });
    },

    renderQuestion: function(variant, question, submission, course, locals, callback) {
        this.renderFile('question.html', variant, question, submission, course, locals, (err, html) => {
            if (ERR(err, callback)) return;
            callback(null, html);
        });
    },

    renderSubmission: function(variant, question, submission, course, locals, callback) {
        this.renderFile('submission.html', variant, question, submission, course, locals, (err, html) => {
            if (ERR(err, callback)) return;
            callback(null, html);
        });
    },

    renderTrueAnswer: function(variant, question, course, locals, callback) {
        this.renderFile('answer.html', variant, question, null, course, locals, (err, html) => {
            if (ERR(err, callback)) return;
            callback(null, html);
        });
    },

    execPython: function(pythonFile, pythonFunction, pythonArgs, pythonCwd, callback) {
        var cmdInput = {file: pythonFile, fcn: pythonFunction, args: pythonArgs, cwd: pythonCwd};
        try {
            var input = JSON.stringify(cmdInput);
        } catch (e) {
            var err = new Error('Error encoding question JSON');
            err.data = {endcodeMsg: e.message, cmdInput};
            return ERR(err, callback);
        }
        var cmdOptions = {
            cwd: pythonCwd,
            input: input,
            timeout: 10000, // milliseconds
            killSignal: 'SIGKILL',
            stdio: ['pipe', 'pipe', 'pipe', 'pipe'], // stdin, stdout, stderr, and an extra one for data
        };
        var cmd = 'python';
        var args = [__dirname + '/python_caller.py'];
        var child = child_process.spawn(cmd, args, cmdOptions);

        child.stderr.setEncoding('utf8');
        child.stdout.setEncoding('utf8');
        child.stdio[3].setEncoding('utf8');

        var outputStdout = '';
        var outputStderr = '';
        var outputBoth = '';
        var outputData = '';

        child.stdout.on('data', (data) => {
            outputStdout += data;
            outputBoth += data;
        });
        
        child.stderr.on('data', (data) => {
            outputStderr += data;
            outputBoth += data;
        });

        child.stdio[3].on('data', (data) => {
            outputData += data;
        });

        var callbackCalled = false;

        child.on('close', (code) => {
            let err, output;
            if (code) {
                err = new Error('Error in question code execution');
                err.data = {code, cmdInput, outputStdout, outputStderr, outputData};
                if (!callbackCalled) {
                    callbackCalled = true;
                    return ERR(err, callback);
                } else {
                    // FIXME: silently swallowing the error here
                    return;
                }
            }
            try {
                output = JSON.parse(outputData);
            } catch (e) {
                err = new Error('Error decoding question JSON');
                err.data = {decodeMsg: e.message, cmdInput, outputStdout, outputStderr, outputData};
                if (!callbackCalled) {
                    callbackCalled = true;
                    return ERR(err, callback);
                } else {
                    // FIXME: silently swallowing the error here
                    return;
                }
            }
            if (!callbackCalled) {
                callbackCalled = true;
                callback(null, output);
            } else {
                // FIXME: silently swallowing the output here
                return;
            }
        });
        
        child.on('error', (error) => {
            let err = new Error('Error executing python question code');
            err.data = {execMsg: error.message, cmdInput};
            if (!callbackCalled) {
                callbackCalled = true;
                return ERR(err, callback);
            } else {
                // FIXME: silently swallowing the error here
                return;
            }
        });

        child.stdin.write(input);
        child.stdin.end();
    },

    execPythonServer: function(pythonFunction, pythonArgs, question, course, callback) {
        var question_dir = path.join(course.path, 'questions', question.directory);
        this.execPython('server', pythonFunction, pythonArgs, question_dir, (err, output) => {
            if (ERR(err, callback)) return;
            callback(null, output);
        });
    },

    makeHandlebars: function() {
        var hb = handlebars.create();
        return hb;
    },

    execTemplate: function(filename, question_data, question, course, callback) {
        var question_dir = path.join(course.path, 'questions', question.directory);
        var question_html = path.join(question_dir, filename);
        fs.readFile(question_html, {encoding: 'utf8'}, (err, data) => {
            if (ERR(err, callback)) return;
            try {
                var hb = this.makeHandlebars();
                var template = hb.compile(data);
            } catch (err) {
                err.data = {question_data, question, course};
                return ERR(err, callback);
            }
            var html;
            try {
                html = template(question_data);
            } catch (err) {
                err.data = {question_data, question, course};
                return ERR(err, callback);
            }
            var $;
            try {
                $ = cheerio.load(html, {
                    recognizeSelfClosing: true,
                });
            } catch (err) {
                err.data = {question_data, question, course};
                return ERR(err, callback);
            }
            callback(null, question_data, html, $);
        });
    },

    getData: function(question, course, variant_seed, callback) {
        var question_dir = path.join(course.path, 'questions', question.directory);

        var pythonArgs = {
            variant_seed: variant_seed,
            options: _.defaults({}, course.options, question.options),
            question_dir: question_dir,
        };
        this.execPythonServer('get_data', pythonArgs, question, course, (err, ret_question_data) => {
            if (ERR(err, callback)) return;
            var question_data = ret_question_data;
            question_data.options = question_data.options || {};
            _.defaults(question_data.options, course.options, question.options);
            question_data.params = question_data.params || {};
            question_data.params._grade = question_data.params._grade || {};
            question_data.params._weights = question_data.params._weights || {};
            question_data.true_answer = question_data.true_answer || {};
            this.execTemplate('question.html', question_data, question, course, (err, question_data, html, $) => {
                if (ERR(err, callback)) return;

                let index = 0;
                async.eachSeries(elements.keys(), (elementName, callback) => {
                    async.eachSeries($(elementName).toArray(), (element, callback) => {
                        this.elementPrepare(elementName, $, element, parseInt(variant_seed, 36), index, question_data, (err) => {
                            if (ERR(err, callback)) return;
                            index++;
                            callback(null);
                        });
                    }, (err) => {
                        if (ERR(err, callback)) return;
                        callback(null);
                    });
                }, (err) => {
                    if (ERR(err, callback)) return;
                    callback(null, question_data);
                });
            });
        });
    },

    getFile: function(filename, variant, question, course, callback) {
        callback(new Error('not implemented'));
    },

    gradeSubmission: function(submission, variant, question, course, callback) {
        const question_data = {
            params: variant.params,
            true_answer: variant.true_answer,
            options: variant.options,
            submitted_answer: submission.submitted_answer,
        };
        async.mapValuesSeries(question_data.params._grade, (elementName, name, callback) => {
            if (!elements.has(elementName)) {
                return callback(null, {score: 0, feedback: 'Invalid element name: ' + elementName});
            }
            this.elementGrade(elementName, name, question_data, question, course, (err, elementGrading) => {
                if (ERR(err, callback)) return;
                callback(null, elementGrading);
            });
        }, (err, elementGradings) => {
            if (ERR(err, callback)) return;
            const feedback = {
                _element_scores: _.mapValues(elementGradings, 'score'),
                _element_feedbacks: _.mapValues(elementGradings, 'feedback'),
            };
            let total_weight = 0, total_weight_score = 0;
            _.each(feedback._element_scores, (score, key) => {
                const weight = _.get(question_data, ['params', '_weights', key], 1);
                total_weight += weight;
                total_weight_score += weight * score;
            });
            const score = total_weight_score / (total_weight == 0 ? 1 : total_weight);
            const correct = (score >= 1);
            const grading = {score, feedback, correct};

            // FIXME: compute tentative score/feedback from elements
            // FIXME: call server.grade()

            // FIXME: rationalize element attrib/name verus name/type
        
            callback(null, grading);
        });
    },
};
