const _ = require('lodash');
const elementHelper = require('../../lib/element-helper');

const RandomGenerator = require('../../lib/random-generator');

module.exports = {};

module.exports.prepare = function($, element, variant_seed, element_index, question_data, callback) {
    try {
        const name = elementHelper.getAttrib(element, 'name');
        const weight = elementHelper.getNumberAttrib(element, 'weight', 1);

        let correctAnswers = [];
        let incorrectAnswers = [];
        for (const answer of $(element).find('answer').toArray()) {
            const correct = elementHelper.getBooleanAttrib(answer, 'correct', false);
            const html = $(answer).html();
            if (correct) {
                correctAnswers.push(html);
            } else {
                incorrectAnswers.push(html);
            }
        }

        var rand = new RandomGenerator(variant_seed + element_index * 37);

        const numberCorrect = correctAnswers.length;
        const numberIncorrect = incorrectAnswers.length;

        // FIXME: allow numberAnswers to be passed as an attribute to checkbox
        // var numberIncorrect = options.numberAnswers - numberCorrect;
        // numberIncorrect = Math.min(numberIncorrect, options.incorrectAnswers.length);

        let answers = [];
        answers = answers.concat(rand.randNElem(numberCorrect, correctAnswers));
        answers = answers.concat(rand.randNElem(numberIncorrect, incorrectAnswers));
        const perm = rand.shuffle(answers);
        answers = _.map(answers, (value, index) => {
            return {key: String.fromCharCode('a'.charCodeAt() + index), html: value};
        });
        const trueIndexes = _.map(_.range(numberCorrect), i => perm.indexOf(i));
        let trueAnswer = _.map(trueIndexes, i => answers[i]);
        trueAnswer = _.sortBy(trueAnswer, 'key');

        question_data.params[name] = answers;
        question_data.params._grade[name] = 'checkbox';
        question_data.params._weights[name] = weight;
        question_data.true_answer[name] = trueAnswer;
        callback(null);
    } catch (err) {
        return callback(err);
    }
};

module.exports.render = function($, element, element_index, question_data, callback) {
    try {
        const name = elementHelper.getAttrib(element, 'name');
        const inline = elementHelper.getBooleanAttrib(element, 'inline', false);
        if (!question_data.params[name]) throw new Error('unable to find params for ' + name);
        const answers = question_data.params[name];

        let submittedKeys = _.get(question_data, ['submitted_answer', name], []);
        if (!_.isArray(submittedKeys)) submittedKeys = [submittedKeys];

        let html = '';
        if (inline) html += '<p>\n';
        for (const ans of answers) {
            if (!inline) html += '<div class="checkbox">\n';
            html
                += '  <label' + (inline ? ' class="checkbox-inline"' : '') + '>\n'
                + '    <input type="checkbox"'
                + ' name="' + name + '" value="' + ans.key + '"'
                + (question_data.editable ? '' : ' disabled')
                + (submittedKeys.includes(ans.key) ? ' checked ' : '')
                + ' />\n'
                + '    (' + ans.key + ') ' + ans.html.trim() + '\n'
                + '  </label>\n';
            if (!inline) html += '</div>\n';
        }
        if (inline) html += '</p>\n';

        callback(null, html);
    } catch (err) {
        return callback(err);
    }
};

module.exports.grade = function(name, question_data, question, course, callback) {
    let trueAnswer = _.get(question_data, ['true_answer', name], null);
    if (trueAnswer == null) return callback(null, {score: 0});

    const trueKeys = _.map(trueAnswer, 'key');
    let submittedKeys = _.get(question_data, ['submitted_answer', name], []);
    if (!_.isArray(submittedKeys)) submittedKeys = [submittedKeys];

    let grading = {};
    if (_.isEqual(trueKeys, submittedKeys)) {
        grading.score = 1;
    } else {
        grading.score = 0;
    }
    return callback(null, grading);
};
