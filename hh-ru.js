const async = require('async');
const request = require('request');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');
const url = require('url');
const sqlite3 = require('sqlite3');

// const BASEURL = 'https://samara.hh.ru/resume/19c8e9510002511e100039ed1f637a6865546e?query=%D0%9F%D1%80%D0%BE%D0%B3%D1%80%D0%B0%D0%BC%D0%BC%D0%B8%D1%81%D1%82';
// const BASEURL = 'https://samara.hh.ru/resume/fd8c0662000307a7180039ed1f62576b38676a?query=%D0%9F%D1%80%D0%BE%D0%B3%D1%80%D0%B0%D0%BC%D0%BC%D0%B8%D1%81%D1%82';
const BASEURL = 'https://samara.hh.ru/search/resume?exp_period=all_time&order_by=publication_time&area=113&text=%D0%9F%D1%80%D0%BE%D0%B3%D1%80%D0%B0%D0%BC%D0%BC%D0%B8%D1%81%D1%82&pos=full_text&logic=normal&clusters=true&page=0';
const TIMEOUT = 2*1000;


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
  for (var c = el.firstChild; c; c = c.nextSibling) {
    walkDom(c, callback);
  }
}

function domToString(el) {
  var textNodes = [];
  walkDom(el, c => {
    if (c.nodeType === 3) {
      // console.log('>> text node', c);
      textNodes.push(c.data);
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

    callback(null, schema);

    /*
    const about = $('.resume-header-block p').map((k, el) => $(el).text()).get().join('\n');
    const position = $('[data-qa="resume-block-title-position"]').text();
    const salary = $('[data-qa="resume-block-salary"]').text();
    const specialization = $('[data-qa="resume-block-specialization-category"]').text();
    const experience = $('[data-qa="resume-block-experience"] .resume-block__title-text_sub').text();
    const info = $('.resume-block .bloko-gap_bottom ~ p').map((k, el) => $(el).text()).get();
    const resume = $('.resume-block-item-gap[itemprop="worksFor"]').map((k, el) => domToString(el)).get();
    const education = $('.resume-block-item-gap[data-qa="resume-block-education"]').map((k, el) => domToString(el)).get();
    const workSkills = $('[data-qa="bloko-tag__text"]').text();
    const skills = $('[data-qa="resume-block-skills"]').text();
    const lang = $('[data-qa="resume-block-language-item"]').map((k, el) => $(el).text()).get();
    */
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
          console.log('>> result');
          console.log(doc);
          callback();
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
