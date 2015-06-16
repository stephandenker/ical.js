/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * Portions Copyright (C) Philipp Kewisch, 2011-2015 */


/**
 * This symbol is further described later on
 * @ignore
 */
ICAL.RecurIterator = (function() {

  /**
   * @classdesc
   * An iterator for a single recurrence rule. This class usually doesn't have
   * to be instanciated directly, the convenience method
   * {@link ICAL.Recur#iterator} can be used.
   *
   * @description
   * The options object may contain additional members when resuming iteration from a previous run
   *
   * @description
   * The options object may contain additional members when resuming iteration
   * from a previous run.
   *
   * @class
   * @alias ICAL.RecurIterator
   * @param {Object} options                The iterator options
   * @param {ICAL.Recur} options.rule       The rule to iterate.
   * @param {ICAL.Time} options.dtstart     The start date of the event.
   * @param {Boolean=} options.initialized  When true, assume that options are
   *        from a previously constructed iterator. Initialization will not be
   *        repeated.
   */
  function icalrecur_iterator(options) {
    this.fromData(options);
  }

  icalrecur_iterator.prototype = {

    /**
     * True when iteration is finished.
     * @type {Boolean}
     */
    completed: false,

    /**
     * If true, duplicate instances are not protected when calling
     * {@link ICAL.RecurIterator#next}.
     * @type {Boolean}
     */
    duplicates: false,

    /**
     * The rule that is being iterated
     * @type {ICAL.Recur}
     */
    rule: null,

    /**
     * The start date of the event being iterated.
     * @type {ICAL.Time}
     */
    dtstart: null,

    /**
     * The last occurrence that was returned from the
     * {@link ICAL.RecurIterator#next} method.
     * @type {ICAL.Time}
     */
    last: null,

    /**
     * The sequence number from the occurrence
     * @type {Number}
     */
    occurrence_number: 0,

    /**
     * The indices used for the {@link ICAL.RecurIterator#by_data} object.
     * @type {Object}
     * @private
     */
    by_indices: null,

    /**
     * If true, the iterator has already been initialized
     * @type {Boolean}
     * @private
     */
    initialized: false,

    /**
     * The initializd by-data.
     * @type {Object}
     * @private
     */
    by_data: null,

    /**
     * The expanded yeardays
     * @type {Array}
     * @private
     */
    days: null,

    /**
     * The index in the {@link ICAL.RecurIterator#days} array.
     * @type {Number}
     * @private
     */
    days_index: 0,

    /**
     * Initialize the recurrence iterator from the passed data object. This
     * method is usually not called directly, you can initialize the iterator
     * through the constructor.
     *
     * @param {Object} options                The iterator options
     * @param {ICAL.Recur} options.rule       The rule to iterate.
     * @param {ICAL.Time} options.dtstart     The start date of the event.
     * @param {Boolean=} options.initialized  When true, assume that options are
     *        from a previously constructed iterator. Initialization will not be
     *        repeated.
     */
    fromData: function(options) {
      this.rule = ICAL.helpers.formatClassType(options.rule, ICAL.Recur);

      if (!this.rule) {
        throw new Error('iterator requires a (ICAL.Recur) rule');
      }

      this.dtstart = ICAL.helpers.formatClassType(options.dtstart, ICAL.Time);

      if (!this.dtstart) {
        throw new Error('iterator requires a (ICAL.Time) dtstart');
      }

      if (options.by_data) {
        this.by_data = options.by_data;
      } else {
        this.by_data = ICAL.helpers.clone(this.rule.parts, true);
      }

      if (options.by_iter) {
        this.by_iter = options.by_iter;
        for (var key in this.by_iter) {
          /* istanbul ignore if */
          if (!this.by_iter.hasOwnProperty(key)) {
            continue;
          }
          this.by_iter[key] = ByComponentIterator.fromJSON(this.by_iter[key]);
        }
      }

      if (options.by_cache) {
        this.by_cache = options.by_cache.map(function(dtstr) {
          return ICAL.Time.fromString(dtstr);
        });
      }

      if (options.occurrence_number) {
        this.occurrence_number = options.occurrence_number;
      }

      this.days = options.days || [];
      this.last = options.last ? ICAL.helpers.formatClassType(options.last, ICAL.Time) : null;

      this.by_indices = options.by_indices;

      this.by_data_byday = options.by_data_byday;
      this.by_cache = [];
      this.by_cache_year = options.by_cache_year;

      if (!this.by_indices) {
        this.by_indices = {
          "BYSECOND": 0,
          "BYMINUTE": 0,
          "BYHOUR": 0,
          "BYDAY": 0,
          "BYMONTH": 0,
          "BYWEEKNO": 0,
          "BYMONTHDAY": 0
        };
      }

      this.initialized = options.initialized || false;

      if (!this.initialized) {
        this.init();
      }
    },

    /**
     * Intialize the iterator
     * @private
     */
    init: function icalrecur_iterator_init() {
      this.initialized = true;
      this.last = this.dtstart.clone();
      var parts = this.by_data;

      if ("BYDAY" in parts) {
        // libical does this earlier when the rule is loaded, but we postpone to
        // now so we can preserve the original order.
        this.sort_byday_rules(parts.BYDAY, this.rule.wkst);
      }

      // For MONTHLY recurrences (FREQ=MONTHLY) neither BYYEARDAY nor
      // BYWEEKNO may appear.
      if (this.rule.freq == "MONTHLY" &&
          ("BYYEARDAY" in parts || "BYWEEKNO" in parts)) {
        throw new Error("For MONTHLY recurrences neither BYYEARDAY nor BYWEEKNO may appear");
      }

      // For WEEKLY recurrences (FREQ=WEEKLY) neither BYMONTHDAY nor
      // BYYEARDAY may appear.
      if (this.rule.freq == "WEEKLY" &&
          ("BYYEARDAY" in parts || "BYMONTHDAY" in parts)) {
        throw new Error("For WEEKLY recurrences neither BYMONTHDAY nor BYYEARDAY may appear");
      }

      // BYYEARDAY may only appear in HOURLY/MINUTELY/SECONDLY/YEARLY rules
      if (this.rule.freq != "YEARLY" && this.rule.freq != "SECONDLY" &&
          this.rule.freq != "MINUTELY" && this.rule.freq != "HOURLY" &&
          "BYYEARDAY" in parts) {
        throw new Error("BYYEARDAY may only appear in SECONDLY/MINUTELY/HOURLY/YEARLY rules");
      }


      switch (this.rule.freq) {
        case "SECONDLY":
          this._initSecondly();
          break;
        case "MINUTELY":
          this._initMinutely();
          break;
        case "HOURLY":
          this._initHourly();
          break;
        case "DAILY":
          this._initDaily();
          break;
        case "WEEKLY":
          this._initWeekly();
          break;
        case "MONTHLY":
          this._initMonthly();
          break;
        case "YEARLY":
          this._initYearly();
          break;
      }
      this._initCommon();

      this.by_iter = {};
      for (var bycomp in this.by_data) {
        /* istanbul ignore if */
        if (!this.by_data.hasOwnProperty(bycomp)) {
          continue;
        }

        this.by_iter[bycomp] = new ByComponentIterator(this.by_data[bycomp]);
      }
    },

    /**
     * Fast forward the iterator to a date, which may or may not be an occurrence date.
     *
     * @example
     * var iter = rrrule.iterator(dtstart);
     * for (var next = iter.fastForward(myRangeStart); next ; next = iter.next()) {
     *   ...
     * }
     * @param {ICAL.Time} rangeStart        The date to forward to
     * @return {?ICAL.Time}                 The first occurrence after rangeStart.
     */
    fastForward: function(rangeStart) {
      if (rangeStart.compare(this.dtstart) < 0) {
        throw new Error("Can't fastForward before DTSTART");
      }

      // Make sure the range is of the same type as dtstart.
      rangeStart.isDate = this.dtstart.isDate;

      // If COUNT is defined, it is hard to calculate when the recurrence ends.
      // Since most count rules will have a reasonably low value, we fall back
      // to going to the dtstart and checking each occurrence.
      var originalRangeStart;
      if (this.rule.count) {
        originalRangeStart = rangeStart;
        rangeStart = this.dtstart;
      }

      // If we are iterating from dtstart, we can reset the occurrence number.
      if (rangeStart == this.dtstart) {
        this.occurrence_number = 0;
      }

      if (this.rule.until && this.rule.until.compare(rangeStart) < 0) {
        // Fast forwarding to after the until date will return no results, we
        // don't have to set up the iterator in that case.
        this.completed = true;
        return null;
      }

      this.by_iter.BYMONTH.reset();
      this.by_iter.BYMONTHDAY.reset();
      this.by_iter.BYHOUR.reset();
      this.by_iter.BYMINUTE.reset();
      this.by_iter.BYSECOND.reset();
      this.by_cache_year = rangeStart.year;

      var SECONDLY = 0;
      var MINUTELY = 1;
      var HOURLY = 2;
      var DAILY = 3;
      var WEEKLY = 4;
      var MONTHLY = 5;
      var YEARLY = 6;
      var FREQ_MAP = {
        SECONDLY: 0,
        MINUTELY: 1,
        HOURLY: 2,
        DAILY: 3,
        WEEKLY: 4,
        MONTHLY: 5,
        YEARLY: 6
      };

      var freq = this.rule.freq;
      var ordFreq = FREQ_MAP[freq];
      var byiter = this.by_iter;
      var year = this.year;
      var nosetpos = !this.by_data.BYSETPOS;

      // Sorry, this is not really readable. I tried to split up the if-blocks
      // at least and add comments, but it may not be enough. In general we
      // want to find the exact position our rangeStart is, in all iterators.
      // If there is BYSETPOS data, then we need the whole set so we stop a
      // little earlier.

      function findHMS(day) {
        // If we have at least DAILY or the day matches then find the hour.
        if (ordFreq > HOURLY || day == rangeStart.day) {
          // If there is BYSETPOS data, only find the hour for HOURLY and below
          if (nosetpos || ordFreq <= HOURLY) {
            var hour = byiter.BYHOUR.find(rangeStart.hour);

            // If we have at least HOURLY or the hour matches then find the minute.
            if (ordFreq > MINUTELY || hour == rangeStart.hour) {
              // If there is BYSETPOS data, only find the minute for MINUTELY and below
              if (nosetpos || ordFreq <= MINUTELY) {
                var minute = byiter.BYMINUTE.find(rangeStart.minute);

                // If we have at least MINUTELY or the minute matches then find the second.
                if (ordFreq > SECONDLY || minute == rangeStart.minute) {
                  // If there is BYSETPOS data, only find the second for SECONDLY
                  if (nosetpos || ordFreq <= SECONDLY) {
                    byiter.BYSECOND.find(rangeStart.second);
                  }
                }
              }
            }
          }
        }
      }

      if (this.by_iter.BYYEARDAY) {
        // TODO try flipping this around?
        var rangeStartDOY = rangeStart.dayOfYear();
        var daysInYear = ICAL.Time.isLeapYear(this.by_cache_year) ? 366 : 365;
        this.by_iter.BYYEARDAY.max = daysInYear;

        var yday = this.by_iter.BYYEARDAY.find(rangeStartDOY);
        if (this.by_iter.BYYEARDAY.wrapped) {
          // TODO wrap year for other paths too
          this.by_cache_year++;
          daysInYear = ICAL.Time.isLeapYear(this.by_cache_year) ? 366 : 365;
          this.by_iter.BYYEARDAY.max = daysInYear;
        }

        if (yday < 0) {
          yday += daysInYear + 1;
        }

        if (yday == rangeStartDOY && this.by_cache_year == rangeStart.year) {
          findHMS(rangeStart.day);
        }
      } else {
        var month = this.by_iter.BYMONTH.find(rangeStart.month);
        // If we have at least MONTHLY or the month matches, then find the day.
        if (ordFreq > DAILY || month == rangeStart.month && this.by_cache_year == rangeStart.year) {
          // If there is BYSETPOS data, only find the day for DAILY and below.
          if (nosetpos || ordFreq <= DAILY) {
            var day = this.by_iter.BYMONTHDAY.find(rangeStart.day);
            findHMS(day);
          }
        }
      }

      //console.log("CUR: " + this._getCurrentDate());

      this.by_cache = [];
      var includeCurrent = true;
      do {
        var occs = this._getNextSet(includeCurrent);
        //console.log(occs.map(String));
        includeCurrent = false;

        occs.splice(0, ICAL.helpers.binsearchInsert(occs, rangeStart, function(a, b) {
          return a.compare(b);
        }));
        this.by_cache = occs;
        // TODO bail if no occurrences can be resolved
      } while (!this.by_cache.length);

      this.last = this._iterate();

      if (this.rule.count) {
        this.last = this.iterateTo(originalRangeStart);
      }

      return this.last;
    },

    /**
     * Moves the iterator forward to the given date, going through each
     * occurrence. This function should only be used if the calling code
     * expects {@link ICAL.RecurIterator#occurrence_number} to be preserved.
     *
     * If possible, the {@link ICAL.RecurIterator#fastForward} method should be
     * preferred. It has far better performance because it doesn't have to
     * calculate each occurrence from dtstart to rangeStart.
     *
     * @param {ICAL.Time} rangeStart        The date to iterate forward to.
     * @return {?ICAL.Time}                 The first occurrence after rangeStart.
     */
    iterateTo: function(rangeStart) {
      var next = this.last;
      while (next && next.compare(rangeStart) < 0) {
        next = this.next();
      }
      return next;
    },

    _initSecondly: function() {
      var bydata = this.by_data;
      var dtstart = this.dtstart;

      if (dtstart.isDate) {
        throw new Error("Cannot expand HOURLY without a date-time");
      }

      if (!this.has_by_data("BYMONTH")) { // Limit
        bydata.BYMONTH = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
      }

      if (!this.has_by_data("BYMONTHDAY")) { // Limit
        bydata.BYMONTHDAY = [
          1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
          17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31
        ];
      }

      if (!this.has_by_data("BYDAY")) { // Limit
        bydata.BYDAY = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
      }

      if (!this.has_by_data("BYHOUR")) { // Limit
        bydata.BYHOUR = [
          0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
          13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23
        ];
      }
      if (!this.has_by_data("BYMINUTE")) { // Expand
        bydata.BYMINUTE = [
          0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
          16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
          31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45,
          45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60
        ];
      }
      if (!this.has_by_data("BYSECOND")) { // Expand
        bydata.BYSECOND = [
          0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
          16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
          31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45,
          45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60
        ];
      }
    },

    _initMinutely: function() {
      var bydata = this.by_data;
      var dtstart = this.dtstart;

      if (dtstart.isDate) {
        throw new Error("Cannot expand HOURLY without a date-time");
      }

      if (!this.has_by_data("BYMONTH")) { // Limit
        bydata.BYMONTH = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
      }

      if (!this.has_by_data("BYMONTHDAY")) { // Limit
        bydata.BYMONTHDAY = [
          1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
          17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31
        ];
      }

      if (!this.has_by_data("BYDAY")) { // Limit
        bydata.BYDAY = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
      }

      if (!this.has_by_data("BYHOUR")) { // Limit
        bydata.BYHOUR = [
          0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
          13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23
        ];
      }
      if (!this.has_by_data("BYMINUTE")) { // Limit
        bydata.BYMINUTE = [
          0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
          16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
          31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45,
          45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60
        ];
      }
      if (!this.has_by_data("BYSECOND")) { // Expand
        bydata.BYSECOND = [dtstart.second];
      }
    },

    _initHourly: function() {
      var bydata = this.by_data;
      var dtstart = this.dtstart;

      if (dtstart.isDate) {
        throw new Error("Cannot expand HOURLY without a date-time");
      }

      if (!this.has_by_data("BYMONTH")) { // Limit
        bydata.BYMONTH = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
      }

      if (!this.has_by_data("BYMONTHDAY")) { // Limit
        bydata.BYMONTHDAY = [
          1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
          17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31
        ];
      }

      if (!this.has_by_data("BYDAY")) { // Limit
        bydata.BYDAY = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
      }

      if (!this.has_by_data("BYHOUR")) { // Limit
        bydata.BYHOUR = [
          0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
          13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23
        ];
      }
      if (!this.has_by_data("BYMINUTE")) { // Expand
        bydata.BYMINUTE = [dtstart.minute];
      }
      if (!this.has_by_data("BYSECOND")) { // Expand
        bydata.BYSECOND = [dtstart.second];
      }
    },

    _initDaily: function() {
      var dtstart = this.dtstart;
      var bydata = this.by_data;

      if (!this.has_by_data("BYDAY")) {
        bydata.BYDAY = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
      }
      if (!this.has_by_data("BYMONTH")) {
        bydata.BYMONTH = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
      }
      if (!this.has_by_data("BYMONTHDAY")) {
        bydata.BYMONTHDAY = [
          1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
          20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31
        ];
      }
      if (!this.has_by_data("BYHOUR")) { // Expand
        bydata.BYHOUR = [dtstart.hour];
      }
      if (!this.has_by_data("BYMINUTE")) { // Expand
        bydata.BYMINUTE = [dtstart.minute];
      }
      if (!this.has_by_data("BYSECOND")) { // Expand
        bydata.BYSECOND = [dtstart.second];
      }
    },

    _initWeekly: function() {
      var bydata = this.by_data;
      var dtstart = this.dtstart;
      if (!this.has_by_data("BYMONTH")) { // Limit
        bydata.BYMONTH = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
      }

      if (!this.has_by_data("BYDAY")) { //Expand
        bydata.BYDAY = [ICAL.Recur.numericDayToIcalDay(dtstart.dayOfWeek())];
      }
      if (!this.has_by_data("BYHOUR")) { //Expand
        bydata.BYHOUR = [dtstart.hour];
      }
      if (!this.has_by_data("BYMINUTE")) { //Expand
        bydata.BYMINUTE = [dtstart.minute];
      }
      if (!this.has_by_data("BYSECOND")) { //Expand
        bydata.BYSECOND = [dtstart.second];
      }

      if (!this.has_by_data("BYMONTHDAY")) {
        bydata.BYMONTHDAY = [
          1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
          20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31
        ];
      }
    },

    _initMonthly: function() {
      var bydata = this.by_data;
      var dtstart = this.dtstart;
      if (!this.has_by_data("BYMONTH")) { // Limit
        bydata.BYMONTH = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
      }
      if (!this.has_by_data("BYMONTHDAY")) {
        if (this.has_by_data("BYDAY")) { // Limit
          bydata.BYMONTHDAY = [
            1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
            20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31
          ];
        } else { // Expand
          bydata.BYMONTHDAY = [dtstart.day];
        }
      }

      if (!this.has_by_data("BYDAY")) { // Limit
        bydata.BYDAY = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
      }

      if (!this.has_by_data("BYHOUR")) { // Expand
        bydata.BYHOUR = [dtstart.hour];
      }
      if (!this.has_by_data("BYMINUTE")) { // Expand
        bydata.BYMINUTE = [dtstart.minute];
      }
      if (!this.has_by_data("BYSECOND")) { // Expand
        bydata.BYSECOND = [dtstart.second];
      }
    },

    _initYearly: function() {
      var dtstart = this.dtstart;
      var bydata = this.by_data;
      if (!this.has_by_data("BYDAY")) {
        if (this.has_by_data("BYWEEKNO")) { // Limit
          bydata.BYDAY = [ICAL.Recur.numericDayToIcalDay(dtstart.dayOfWeek())];
        } else {
          bydata.BYDAY = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
        }
      }
      if (!this.has_by_data("BYMONTH")) { // Expand
        bydata.BYMONTH = [dtstart.month];
      }

      if (!this.has_by_data("BYMONTHDAY")) { // Expand
          if (this.has_by_data("BYDAY")) {
            bydata.BYMONTHDAY = [
              1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
              20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31
            ];
          } else {
            bydata.BYMONTHDAY = [dtstart.day];
          }
        }

      if (!this.has_by_data("BYHOUR")) { // Expand
        bydata.BYHOUR = [dtstart.hour];
      }
      if (!this.has_by_data("BYMINUTE")) { // Expand
        bydata.BYMINUTE = [dtstart.minute];
      }
      if (!this.has_by_data("BYSECOND")) { // Expand
        bydata.BYSECOND = [dtstart.second];
      }
    },

    _initCommon: function() {
      var maxbyday = 0;
      this.by_data_byday = this.by_data.BYDAY.map(function(byday) {
        var matches = byday.match(/([+-]?[0-9])?(MO|TU|WE|TH|FR|SA|SU)/);
        var pos = parseInt(matches[1] || 0, 10);
        maxbyday = Math.max(maxbyday, Math.abs(pos));
        return [pos, matches[2]];
      });

      if (this.rule.freq == "MONTHLY" && maxbyday > 5) {
        throw new Error("Malformed values in BYDAY part");
      }

      this.by_cache = [];
      this.by_cache_year = 0;


      this.last = null;
    },

    _iterate: function() {
      var between, next;
      var dtstart = this.dtstart;
      var dtstartTime = dtstart.toUnixTime();
      var year = this.by_cache_year;
      var occs = this.by_cache;

      var calculateInterval;
      var wkst = this.rule.wkst || ICAL.Time.MONDAY;
      switch (this.rule.freq) {
        case "SECONDLY":
          calculateInterval = function(next) {
            return (next.toUnixTime() - dtstartTime);
          };
          break;
        case "MINUTELY":
          calculateInterval = function(next) {
            return (next.toUnixTime() - dtstartTime) / 60 | 0;
          };
          break;
        case "HOURLY":
          calculateInterval = function(next) {
            return (next.toUnixTime() - dtstartTime) / 3600 | 0;
          };
          break;
        case "DAILY":
          calculateInterval = function(next) {
            return (next.toUnixTime() - dtstartTime) / 86400 | 0;
          };
          break;
        case "WEEKLY":
          calculateInterval = function(next) {
            var weekEndOfStart = dtstart.endOfWeek(wkst);
            var weekStartOfNext = next.startOfWeek(wkst);
            var weekEndOfNext = next.endOfWeek(wkst);
            var delta = weekStartOfNext.subtractDateTz(weekEndOfStart).days / 7 | 0;
            if (weekEndOfNext.compare(weekEndOfStart) != 0) {
              delta += 1;
            }

            return delta;
          };
          break;
        case "MONTHLY":
          calculateInterval = function(next) {
            return (next.year - dtstart.year) * 12 + (next.month - dtstart.month);
          };
          break;
        case "YEARLY":
          calculateInterval = function(next) {
            return (next.year - dtstart.year);
          };
          break;
      }

      do {
        for (next = occs.shift(); !next; next = occs.shift()) {
          this.by_cache = occs = this._getNextSet();
          if (!occs.length) {
            //throw new Error("Empty set found");
          }
        }

        between = calculateInterval(next);
      } while ((between % this.rule.interval) != 0);


      this.occurrence_number++;

      return next;
    },

    _filterSetpos: function(occs) {
      function reducer(prev, idx) {
        idx += (idx < 0 ? occlen : -1);

        if (occs[idx]) {
          prev.push(occs[idx]);
        }
        return prev;
      }

      var occlen = occs.length;
      occs = this.by_data.BYSETPOS.reduce(reducer, []);

      if (!occs.length) {
        throw new Error("Could not expand BYSETPOS");
      }

      return occs;
    },

    /**
     * Expand BYDAY values to monthdays for a specific year and month.
     *
     * @param {Number} year     The year to expand for.
     * @param {Number} month    The month to expand for.
     * @return {Number}         A mask with the BYDAY days set for the month.
     */
    _bydayMask: function(year, month) {
      // TODO caching
      var ltr = ICAL.Time.getDominicalLetter(year);
      var bydays = this.by_data_byday;
      var byset = 0 | 0;
      for (var i = 0, bylen = bydays.length; i < bylen; i++) {
        var prefix = bydays[i][0], weekday = bydays[i][1];
        if (prefix == 0) {
          byset |= ICAL.constants.DOMINICAL_WEEKDAY_TO_MONTHDAY_MASK[ltr][weekday][month - 1];
        } else if (this.rule.freq == "MONTHLY") {
          // Get the nth weekday relative to the month.
          var days = ICAL.constants.DOMINICAL_WEEKDAY_TO_MONTHDAY_ARRAY[ltr][weekday][month - 1];
          var pos = prefix < 0 ? prefix + days.length : prefix - 1;
          byset |= pos < days.length ? (1 << days[pos]) : 0;
        } else if (this.rule.freq == "YEARLY") {
          // Get the nth weekday relative to the year.
          // TODO cache this too?
          var days = ICAL.constants.DOMINICAL_WEEKDAY_TO_MONTHDAY_ARRAY[ltr][weekday].reduce(function(a, b) {
            return a.concat(b);
          });
          var pos = prefix < 0 ? prefix + days.length : prefix - 1;
          byset |= pos < days.length ? (1 << days[pos]) : 0;
        }
      }
      return byset;
    },

    /**
     * Retrieve the next occurrence from the iterator.
     * @return {ICAL.Time}
     */
    next: function icalrecur_iterator_next() {
      var before = (this.last ? this.last.clone() : null);

      if ((this.rule.count && this.occurrence_number >= this.rule.count) ||
          (this.rule.until && this.last && this.last.compare(this.rule.until) > 0)) {

        //XXX: right now this is just a flag and has no impact
        //     we can simplify the above case to check for completed later.
        this.completed = true;

        return null;
      }

      // The parser starts out without this.last set, which means we need to
      // fast forward to the start date to initialize the by_iters.
      if (this.last) {
        this.last = this._iterate();
      } else {
        this.last = this.fastForward(this.dtstart);
      }

      // TODO is this valid?
      if (!this.duplicates && before && this.last.compare(before) == 0) {
        throw new Error("Same occurrence found twice, protecting " +
                        "you from death by recursion");
      }

      if (this.rule.until && this.last.compare(this.rule.until) > 0) {
        // We've iterated past our until date, go back one occurrence number
        // and finish.
        this.occurrence_number--;
        this.completed = true;
        return null;
      }

      return this.last;
    },

    ruleDayOfWeek: function ruleDayOfWeek(dow) {
      var matches = dow.match(/([+-]?[0-9])?(MO|TU|WE|TH|FR|SA|SU)/);
      if (matches) {
        var pos = parseInt(matches[1] || 0, 10);
        dow = ICAL.Recur.icalDayToNumericDay(matches[2]);
        return [pos, dow];
      } else {
        return [0, 0];
      }
    },


    has_by_data: function has_by_data(aRuleType) {
      return (aRuleType in this.rule.parts);
    },

    sort_byday_rules: function icalrecur_sort_byday_rules(aRules, aWeekStart) {
      for (var i = 0; i < aRules.length; i++) {
        for (var j = 0; j < i; j++) {
          var one = this.ruleDayOfWeek(aRules[j])[1];
          var two = this.ruleDayOfWeek(aRules[i])[1];
          one -= aWeekStart;
          two -= aWeekStart;
          if (one < 0) one += 7;
          if (two < 0) two += 7;

          if (one > two) {
            var tmp = aRules[i];
            aRules[i] = aRules[j];
            aRules[j] = tmp;
          }
        }
      }
    },

    /**
     * Convert iterator into a serialize-able object.  Will preserve current
     * iteration sequence to ensure the seamless continuation of the recurrence
     * rule.
     * @return {Object}
     */
    toJSON: function() {
      var result = Object.create(null);

      result.initialized = this.initialized;
      result.completed = this.completed;
      result.rule = this.rule.toJSON();
      result.dtstart = this.dtstart.toJSON();
      result.by_data = this.by_data;
      result.last = this.last ? this.last.toJSON() : null;
      result.occurrence_number = this.occurrence_number;

      result.by_iter = {};
      for (var key in this.by_iter) {
        /* istanbul ignore if */
        if (!this.by_iter.hasOwnProperty(key)) {
          continue;
        }
        result.by_iter[key] = this.by_iter[key].toJSON();
      }

      result.by_data_byday = this.by_data_byday;
      result.by_cache_year = this.by_cache_year;

      result.by_cache = this.by_cache.map(String);

      // TODO these are from the old iterator
      result.by_indices = this.by_indices;
      result.days = this.days;
      result.days_index = this.days_index;

      return result;
    },


    _getNextSet: function(aIncludeCurrent) {
      var occs = [];
      var nextIsCurrent = aIncludeCurrent;
      var done = false;
      while (!done) {
        // Some occurrences may be invalid, only add those that actually exist.
        // We still want to check for wrapping though, for example a MONTHLY
        // set with BYMONTHDAY=31 will only wrap on the 31st, even if that day
        // is not valid for the month.

        var next = nextIsCurrent ? this._getCurrentDate() : this._getNextDate();
        nextIsCurrent = false;
        if (next) {
          occs.push(next);
        }

        done = true;
        switch (this.rule.freq) {
          case "MONTHLY":
            done = done && this.by_iter.BYMONTHDAY.nextWraps();
            /* falls through */
          case "DAILY":
            done = done && this.by_iter.BYHOUR.nextWraps();
            /* falls through */
          case "HOURLY":
            done = done && this.by_iter.BYMINUTE.nextWraps();
            /* falls through */
          case "MINUTELY":
            done = done && this.by_iter.BYSECOND.nextWraps();
        }
      }

      if (this.by_data.BYSETPOS) {
        occs = this._filterSetpos(occs);
      }
      return occs;
    },

    _getCurrentDate: function() {
      var dt;
      if (this.by_data.BYWEEKNO) {
        var weekno = this.by_iter.BYWEEKNO.peek();
        var wkst = this.rule.wkst || ICAL.Time.MONDAY;
        var weeksInYear = ICAL.Time.weeksInYear(this.by_cache_year);

        dt = ICAL.Time.weekOneStarts(this.by_cache_year, wkst);
        if (weekno < 0) {
          weekno += weeksInYear + 1;
        }

        var byday = this.by_iter.BYDAY.peek();
        //console.log(this.by_iter.BYDAY.arr);
        var delta = (weekno - 1) * 7 +
          ICAL.Recur.icalDayToNumericDay(byday) -
          ICAL.Time.MONDAY;

        //console.log("CD w1: " + dt,weekno,delta,byday);
        dt.day += delta;
        //console.log("CD AFTER: " + dt);

      } else if (this.by_data.BYYEARDAY) {
        var yday = this.by_iter.BYYEARDAY.peek();
        var daysInYear = ICAL.Time.isLeapYear(this.by_cache_year) ? 366 : 365;

        if (yday < -daysInYear || yday > daysInYear) {
          return null;
        } else if (yday < 0) {
          yday += daysInYear + 1;
        }

        dt = ICAL.Time.fromDayOfYear(yday, this.by_cache_year);
        // TODO performance
        if (this.by_data.BYMONTH.indexOf(dt.month) < 0) {
          return null;
        }
        if (this.by_data.BYMONTHDAY.indexOf(dt.day) < 0) {
          return null;
        }
        var wday = ICAL.Recur.numericDayToIcalDay(dt.dayOfWeek());
        if (this.by_data.BYDAY.indexOf(wday) < 0) {
          return null;
        }
      } else {
        var month = this.by_iter.BYMONTH.peek();
        var day = this.by_iter.BYMONTHDAY.peek();
        // Subtract from end of month if its a negative monthday
        var daysInMonth = ICAL.Time.daysInMonth(month, this.by_cache_year);
        if (day < 0) {
          day += daysInMonth + 1;
        }

        // Check for invalid monthdays, this also catches Feb 29 on leap years.
        if (day > daysInMonth || day < 1) {
          return null;
        }

        // Make sure the given day matches the BYDAY part
        var bdm = this._bydayMask(this.by_cache_year, month);
        if ((bdm & (1 << day)) == 0) {
          return null;
        }

        dt = new ICAL.Time({
          year: this.by_cache_year,
          month: month,
          day: day,
          isDate: true
        });
      }

      dt.isDate = this.dtstart.isDate;
      dt.zone = this.dtstart.zone;
      if (!dt.isDate) {
        dt.hour = this.by_iter.BYHOUR.peek();
        dt.minute = this.by_iter.BYMINUTE.peek();
        dt.second = this.by_iter.BYSECOND.peek();
      }
      //console.log(dt.toString());
      return dt;
    },

    _getNextDate: function() {
      // TODO isDate
      this.by_iter.BYSECOND.next();
      if (this.by_iter.BYSECOND.wrapped) {
        this.by_iter.BYMINUTE.next();
        if (this.by_iter.BYMINUTE.wrapped) {
          this.by_iter.BYHOUR.next();
          if (this.by_iter.BYHOUR.wrapped) {
            // With BYYEARDAY data, go through those next, otherwise go through
            // BYMONTHDAY and BYMONTH.
            if (this.by_data.BYYEARDAY) {
              this.by_iter.BYYEARDAY.next();
              if (this.by_iter.BYYEARDAY.wrapped) {
                this.by_cache_year++;
                this.by_iter.BYYEARDAY.max = ICAL.Time.isLeapYear(this.by_cache_year) ? 366 : 365;
              }
            } else if (this.by_data.BYWEEKNO) {
                this.by_iter.BYWEEKNO.next();
                if (this.by_iter.BYWEEKNO.wrapped) {
                  this.by_cache_year++;
                }
            } else {
              this.by_iter.BYMONTHDAY.next();
              if (this.by_iter.BYMONTHDAY.wrapped) {
                this.by_iter.BYMONTH.next();
                if (this.by_iter.BYMONTH.wrapped) {
                  this.by_cache_year++;
                }
              }
            }
          }
        }
      }
      return this._getCurrentDate();
    }
  };

  icalrecur_iterator._indexMap = {
    "BYSECOND": 0,
    "BYMINUTE": 1,
    "BYHOUR": 2,
    "BYDAY": 3,
    "BYMONTHDAY": 4,
    "BYYEARDAY": 5,
    "BYWEEKNO": 6,
    "BYMONTH": 7,
    "BYSETPOS": 8
  };

  icalrecur_iterator._expandMap = {
    "SECONDLY": [1, 1, 1, 1, 1, 1, 1, 1],
    "MINUTELY": [2, 1, 1, 1, 1, 1, 1, 1],
    "HOURLY": [2, 2, 1, 1, 1, 1, 1, 1],
    "DAILY": [2, 2, 2, 1, 1, 1, 1, 1],
    "WEEKLY": [2, 2, 2, 2, 3, 3, 1, 1],
    "MONTHLY": [2, 2, 2, 2, 2, 3, 3, 1],
    "YEARLY": [2, 2, 2, 2, 2, 2, 2, 2]
  };
  icalrecur_iterator.UNKNOWN = 0;
  icalrecur_iterator.CONTRACT = 1;
  icalrecur_iterator.EXPAND = 2;
  icalrecur_iterator.ILLEGAL = 3;

  function cmpNumeric(a, b) {
    return (a > b) - (b > a);
  }

  function ByComponentIterator(arr) {
    this.arr = arr;
    this._cmp = this._cmp.bind(this);
    this.reset();
  }

  ByComponentIterator.prototype = {
    _cmp: function(a, b) {
      if (a < 0) {
        a += this._max + 1;
      }
      if (b < 0) {
        b += this._max + 1;
      }
      return (a > b) - (b > a);
    },

    get _positiveArr() {
      var max = this._max;
      return this.arr.map(function(d) {
        return d < 0 ? max + 1 + d : d;
      });
    },

    get max() {
      return this._max;
    },
    set max(val) {
      var changed = (this._max != val);
      this._max = val;
      if (changed && val) {
        this.arr.sort(this._cmp);
      }
      return this._max;
    },

    peek: function() {
      return this.arr[this.idx];
    },

    reset: function() {
      this.idx = 0;
      this.wrapped = (this.arr.length == 1);
    },

    peekNext: function() {
      return this.arr[(this.idx + 1) % this.arr.length];
    },

    nextWraps: function() {
      return (this.idx + 1 == this.arr.length);
    },
    prevWraps: function() {
      return (this.idx - 1 == 0);
    },

    next: function() {
      this.wrapped = (this.idx == this.arr.length - 1);
      if (this.wrapped) {
        this.idx = -1;
      }
      return this.arr[++this.idx];
    },

    peekPrev: function() {
      return this.arr[this.idx - 1];
    },

    prev: function() {
      this.wrapped = (this.idx == 0);
      if (this.wrapped) {
        this.idx = this.arr.length;
      }
      return this.arr[--this.idx];
    },

    find: function(val) {
      this.idx = ICAL.helpers.binsearchInsert(this.arr, val, this._cmp);
      this.wrapped = (this.idx == this.arr.length);
      if (this.wrapped) {
        this.idx = 0;
      }
      return this.arr[this.idx];
    },

    toJSON: function() {
      return {
        arr: this.arr,
        idx: this.idx,
        wrapped: this.wrapped
      };
    }
  };

  ByComponentIterator.fromJSON = function(data) {
    var iter = new ByComponentIterator(data.arr);
    iter.idx = data.idx;
    iter.wrapped = data.wrapped;
    return iter;
  };

  return icalrecur_iterator;

}());
