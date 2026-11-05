// Subjunctive Set — question bank
// Transcribed from "Latin 3: Present Subjunctive" (48 questions) and
// "latin 3: imperfect subjunctive" (44 questions). Each entry is
// [given verb form, correct answer]. Players type the answer (no multiple choice).

(function () {
  const make = (tense, voice, rows) =>
    rows.map(([verb, answer]) => ({ verb, answer, tense, voice }));

  const present = [
    ...make('present', 'active', [
      ['amo', 'amem'], ['mones', 'moneas'], ['regit', 'regat'], ['capimus', 'capiamus'],
      ['auditis', 'audiatis'], ['vocant', 'vocent'], ['doceo', 'doceam'], ['ducis', 'ducas'],
      ['facit', 'faciat'], ['punimus', 'puniamus'], ['volatis', 'voletis'], ['terrent', 'terreant'],
      ['occido', 'occidam'], ['iacis', 'iacias'], ['dormit', 'dormiat'], ['nuntiamus', 'nuntiemus'],
      ['completis', 'compleatis'], ['exponunt', 'exponant'], ['capio', 'capiam'], ['munis (4th)', 'munias'],
      ['pugnat', 'pugnet'], ['movemus', 'moveamus'], ['dicitis', 'dicatis'], ['veniunt', 'veniant'],
    ]),
    ...make('present', 'passive', [
      ['superor', 'superer'], ['sederis', 'sedearis'], ['traditur (3rd)', 'tradatur'], ['fugimur', 'fugiamur'],
      ['circumvenimini', 'circumveniamini'], ['ambulantur', 'ambulentur'], ['pendeo (2nd)', 'pendear'],
      ['mitteris', 'mittaris'], ['conspicitur', 'conspiciatur'], ['audimur', 'audiamur'],
      ['incitamini', 'incitemini'], ['moventur', 'moveantur'], ['traducor', 'traducar'], ['regeris', 'regaris'],
      ['iacitur', 'iaciatur'], ['dormimur', 'dormiamur'], ['occupamini', 'occupemini'], ['vincuntur', 'vincantur'],
      ['clamor', 'clamer'], ['videris', 'videaris'], ['mittitur', 'mittatur'], ['deficimur', 'deficiamur'],
      ['punimini', 'puniamini'], ['occiduntur', 'occidantur'],
    ]),
  ];

  const imperfect = [
    ...make('imperfect', 'active', [
      ['amabam', 'amarem'], ['portabas', 'portares'], ['veniebat', 'veniret'], ['monebamus', 'moneremus'],
      ['ducebatis', 'duceretis'], ['capiebant', 'caperent'], ['puniebam', 'punirem'], ['occupabas', 'occupares'],
      ['docebat', 'doceret'], ['cogebamus', 'cogeremus'], ['deficiebatis', 'deficeretis'], ['muniebant', 'munirent'],
    ]),
    ...make('present', 'active', [
      ['amat', 'amet'], ['monemus', 'moneamus'], ['ducitis', 'ducatis'], ['sum', 'sim'], ['possunt', 'possint'],
      ['vides', 'videas'], ['audit', 'audiat'], ['dormimus', 'dormiamus'], ['pervenitis', 'perveniatis'],
      ['currunt', 'currant'],
    ]),
    ...make('imperfect', 'passive', [
      ['portabar', 'portarer'], ['manetur', 'maneretur'], ['muniebamur', 'muniremur'],
      ['currebamini', 'curreremini'], ['cogebantur', 'cogerentur'], ['mittebatur', 'mitteretur'],
      ['interficiebam', 'interficerer'], ['discedebamini', 'discederemini'], ['vulnerabamur', 'vulneraremur'],
      ['inveniebaris', 'invenireris'],
    ]),
    ...make('imperfect', 'active', [
      ['eram', 'essem'], ['eras', 'esses'], ['erat', 'esset'], ['eramus', 'essemus'], ['eratis', 'essetis'],
      ['erant', 'essent'], ['poteram', 'possem'], ['poteras', 'posses'], ['poterat', 'posset'],
      ['poteramus', 'possemus'], ['poteratis', 'possetis'], ['poterant', 'possent'],
    ]),
  ];

  window.SUBJUNCTIVE_SET = { present, imperfect };
})();
