const async = require('async');
const request = require('request');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');
const url = require('url');
const sqlite3 = require('sqlite3');

// const BASEURL = 'https://samara.hh.ru/resume/697563de000336c85a0039ed1f303134497537';
const BASEURL = 'https://samara.hh.ru/search/resume?exp_period=all_time&order_by=publication_time&text=%D0%9F%D1%80%D0%BE%D0%B3%D1%80%D0%B0%D0%BC%D0%BC%D0%B8%D1%81%D1%82&pos=full_text&logic=normal&clusters=true&page=127';
const TIMEOUT = 20*1000;

const db = new sqlite3.Database('./out.db');


function fetch(url, callback) {
  request(url, (error, response, body) => {
    if (error) return callback(error, null);
    callback(null, body);
  });

  // request(url, { encoding: 'binary' }, (error, response, body) => {
  //   if (error) return callback(error, null);
  //   callback(null, iconv.decode(Buffer.from(body, 'binary'), 'win1251'));
  // });
}

function walkDom(el, callback) {
  callback(el);
  for (let node = el.firstChild; node != null; node = node.nextSibling) {
    walkDom(node, callback);
  }
}

function domToString(el) {
  let textNodes = [];
  !el || walkDom(el, node => {
    if (node) {
      if (node.nodeType === 3) {
        textNodes.push(node.data);
      }
    }
  });
  return textNodes.join(' ');
}

function fetchResumeDoc(targetUrl, callback) {
  console.log('>> fetch resume');
  fetch(targetUrl, (error, body) => {
    if (error) {
      return callback(error, null);
    }

    const $ = cheerio.load(body);

    const schema = $('[itemtype]').get().map((el) => {
      return [el.attribs['itemtype'], domToString(el)];
    });

    const about = $('.resume-header-block p').map((k, el) => $(el).text()).get();
    const position = $('[data-qa="resume-block-title-position"]').text();
    const salary = $('[data-qa="resume-block-salary"]').text();
    const specialization = $('[data-qa="resume-block-specialization-category"]').text();
    const experience = $('[data-qa="resume-block-experience"] .resume-block__title-text_sub').text();
    const info = $('.resume-block .bloko-gap_bottom ~ p').map((k, el) => $(el).text()).get();
    const resume = $('.resume-block-item-gap[itemprop="worksFor"]').map((k, el) => domToString(el)).get();
    const education = $('.resume-block-item-gap[data-qa="resume-block-education"]').map((k, el) => domToString(el)).get();
    const workSkills = $('[data-qa="bloko-tag__text"]').map((k, el) => domToString(el)).get();
    const skills = domToString($('[data-qa="resume-block-skills"]').get(0));
    const lang = $('[data-qa="resume-block-language-item"]').map((k, el) => $(el).text()).get();

    callback(null, {
      schema,
      custom: {
        about: about.join('\n'),
        info: info.join('\n'),
        resume: resume.join('\n\n'),
        lang: lang.join('\n'),
        education: education.join('\n'),
        workSkills: workSkills.join('\n'),
        position, salary, specialization,
        experience, skills
      }
    });
  });
}

function fetchSerpDoc(targetUrl, callback) {
  console.log('>> fetch serp');
  fetch(targetUrl, (error, body) => {
    if (error) {
      return callback(error, null);
    }

    const $ = cheerio.load(body);
    const doc = {
      nextPage: null,
      results: []
    };

    doc.results = $('a[data-qa="resume-serp__resume-title"]').get().map(a => {
      return 'https://samara.hh.ru' + a.attribs.href.replace(/\?.+$/, '');
    });

    const linkNext = $('a.HH-Pager-Controls-Next');
    if (linkNext.length) {
      doc.nextPage = 'https://samara.hh.ru' + linkNext.get(0).attribs.href;
    }

    callback(null, doc);
  });
}

function persistCustom(custom, uri, callback) {
  const query = 'INSERT INTO dataCustom ' +
    '(about, info, resume, lang, education, workSkills, position, salary, specialization, experience, skills, uri) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
  const args = [
    custom.about, custom.info, custom.resume, custom.lang, custom.education,
    custom.workSkills, custom.position, custom.salary, custom.specialization,
    custom.experience, custom.skills, uri];
  db.run(query, args, ((error) => {
    if (error) {
      console.log('>> persist custom: fail:', error);
      callback();
    }
    else {
      callback();
    }
  }));
}

function persistSchema(schema, uri, callback) {
  if (schema.length) {
    const query = 'INSERT INTO dataSchema (property, value, uri) VALUES ' +
      '(?, ?, ?), '.repeat(Math.max(0, schema.length - 1)) + '(?, ?, ?)';
    const args = [].concat.apply([], schema.map(pair => {
      return [].concat(pair, [uri]);
    }));
    db.run(query, args, ((error) => {
      if (error) {
        console.log('>> persist schema: fail:', error);
        callback();
      }
      else {
        callback();
      }
    }));
  }
  else {
    callback();
  }
}

function persist(doc, uri, callback) {
  persistSchema(doc.schema, uri, () => {
    persistCustom(doc.custom, uri, () => {
      console.log('>> persist ok');
      callback();
    });
  });
}

let q = async.queue(function(task, callback) {
  console.log('>> TASK', task.type, task.uri);
  if (task.type === 'serp') {
    setTimeout(() => {
      fetchSerpDoc(task.uri, (error, doc) => {
        if (error) {
          console.log('>> serp: error:', error);
          return callback();
        }
        else {
          console.log('>> ok');
          doc.results.forEach(href => {
            q.push({
              type: 'resume',
              uri: href
            });
          });
          if (doc.nextPage) {
            q.push({
              type: 'serp',
              uri: doc.nextPage
            });
          }
          callback();
        }
      });
    }, TIMEOUT);
  }
  else if (task.type === 'resume') {
    setTimeout(() => {
      fetchResumeDoc(task.uri, (error, doc) => {
        if (error) {
          console.log('>> resume: error:', error);
          callback();
        }
        else {
          console.log('>> ok');
          persist(doc, task.uri, callback);
        }
      });
    }, TIMEOUT);
  }
  else {
    callback();
  }
}, 1);

q.drain = function() {
  console.log('>> QUEUE EMPTY');
};

q.push({
  type: 'serp',
  uri: BASEURL
});
