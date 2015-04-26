(function() {
  assert = require('chai').assert;

  assert.hasProperties = function chai_hasProperties(given, props, msg) {
    msg = (typeof(msg) === 'undefined') ? '' : msg + ': ';

    if (props instanceof Array) {
      props.forEach(function(prop) {
        assert.ok(
          (prop in given),
          msg + 'given should have "' + prop + '" property'
        );
      });
    } else {
      for (var key in props) {
        assert.deepEqual(
          given[key],
          props[key],
          msg + ' property equality for (' + key + ') '
        );
      }
    }
  };

  testSupport = {};

  testSupport.requireICAL = function() {
    require('../lib/ical/helpers.js');
    require('../lib/ical/helpers.js');
    require('../lib/ical/helpers.js');
    require('../lib/ical/recur_expansion.js');
    require('../lib/ical/event.js');
    require('../lib/ical/component_parser.js');
    require('../lib/ical/design.js');
    require('../lib/ical/parse.js');
    require('../lib/ical/stringify.js');
    require('../lib/ical/component.js');
    require('../lib/ical/property.js');
    require('../lib/ical/utc_offset.js');
    require('../lib/ical/binary.js');
    require('../lib/ical/period.js');
    require('../lib/ical/duration.js');
    require('../lib/ical/timezone.js');
    require('../lib/ical/timezone_service.js');
    require('../lib/ical/time.js');
    require('../lib/ical/recur.js');
    require('../lib/ical/recur_iterator.js');
  };

  testSupport.load = function(path, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/' + path, true);
    xhr.onreadystatechange = function() {
      if (xhr.readyState === 4) {
        if (xhr.status !== 200) {
          callback(new Error('file not found or other error', xhr));
        } else {
          callback(null, xhr.responseText);
        }
      }
    };
    xhr.send(null);
  };

  testSupport.defineSample = function(file, cb) {
    suiteSetup(function(done) {
      testSupport.load('samples/' + file, function(err, data) {
        if (err) {
          done(err);
        }
        cb(data);
        done();
      });
    });
  };

  testSupport.registerTimezone = function(zone, callback) {
    if (!this._timezones) {
      this._timezones = Object.create(null);
    }

    var ics = this._timezones[zone];

    function register(ics) {
      var parsed = ICAL.parse(ics);
      var calendar = new ICAL.Component(parsed);
      var vtimezone = calendar.getFirstSubcomponent('vtimezone');

      var zone = new ICAL.Timezone(vtimezone);

      ICAL.TimezoneService.register(vtimezone);
    }

    if (ics) {
      setTimeout(function() {
        callback(null, register(ics));
      }, 0);
    } else {
      var path = 'samples/timezones/' + zone + '.ics';
      testSupport.load(path, function(err, data) {
        if (err) {
          callback(err);
        }
        var zone = register(data);
        this._timezones[zone] = data;

        callback(null, register(data));
      }.bind(this));
    }
  };

  testSupport.useTimezones = function(zones) {
    suiteTeardown(function() {
      // to ensure clean tests
      ICAL.TimezoneService.reset();
    });

    Array.prototype.slice.call(arguments).forEach(function(zone) {
      suiteSetup(function(done) {
        testSupport.registerTimezone(zone, done);
      });
    });
  };

  testSupport.requireICAL();
}());
