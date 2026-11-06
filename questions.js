// Built-in question sets, transcribed from "Latin 3: Present Subjunctive" and
// "latin 3: imperfect subjunctive" (all four answer choices from each question).
// Question shape: { tag, q, focus, answers: [...], correct: index, accept: [extra typed answers] }
(function () {
  const make = (tag, rows) => rows.map(([focus, choices, correct]) => {
    const answers = choices.split(' ');
    const right = answers[correct];
    const accept = /passive/.test(tag) && /ris$/.test(right) ? [right.replace(/ris$/, 're')] : [];
    return { tag, q: 'Form the subjunctive of', focus, answers, correct, accept };
  });

  const present = [
    ...make('present active', [
      ['amo', 'amat ame amem amam', 2], ['mones', 'monat mones monas moneas', 3],
      ['regit', 'reget regat regit regeat', 1], ['capimus', 'capiemus capeamus capiamus capimus', 2],
      ['auditis', 'audatis audiatis audetis audietis', 1], ['vocant', 'vocent voceant vocant vocint', 0],
      ['doceo', 'docem doceam doceor docam', 1], ['ducis', 'duceas ducas duces ducis', 1],
      ['facit', 'faciet facet facat faciat', 3], ['punimus', 'punamus punimus puniamus puniemus', 2],
      ['volatis', 'voletis voleatis volatis volitis', 0], ['terrent', 'terreant terrant terrint terrent', 0],
      ['occido', 'occidom occidam occideam occidem', 1], ['iacis', 'iacies iacis iacas iacias', 3],
      ['dormit', 'dormiet dormat dormiat dormit', 2], ['nuntiamus', 'nuntiemus nuntiamus nuntimus nuntamus', 0],
      ['completis', 'compleatis completis complitis complatis', 0], ['exponunt', 'exponant exponent exponeant exponunt', 0],
      ['capio', 'capiar capiem capier capiam', 3], ['munis (4th)', 'munis munias munas munies', 1],
      ['pugnat', 'pugnet pugnat pugnit pugnent', 0], ['movemus', 'movemus moveamus movimus movamus', 1],
      ['dicitis', 'dicatis diceatis diciatis dicetis', 0], ['veniunt', 'veneant venant venient veniant', 3],
    ]),
    ...make('present passive', [
      ['superor', 'superer superar superor superir', 0], ['sederis', 'sedaris sederis sediris sedearis', 3],
      ['traditur (3rd)', 'tradatur tradeatur traditur tradetur', 0], ['fugimur', 'fugamur fugemur fugiemur fugiamur', 3],
      ['circumvenimini', 'circumvenemini circumveniamini circumvenimini circumvenamini', 1],
      ['ambulantur', 'ambuletur ambulentur ambuliantur ambulantur', 1], ['pendeo (2nd)', 'pendear pender pendeor pendar', 0],
      ['mitteris', 'mitteris mittearis mittaris mittiris', 2], ['conspicitur', 'conspiciatur conspicitur conspicetur conspicietur', 0],
      ['audimur', 'audiamur audiamus audiemus audiemur', 0], ['incitamini', 'incitimini incitamini incitemini inciteamini', 2],
      ['moventur', 'movantur moviantur moveantur moventur', 2], ['traducor', 'traducear traducer traducir traducar', 3],
      ['regeris', 'regaris regearis regeris regiris', 0], ['iacitur', 'iacatur iaciatur iacimur iacetur', 1],
      ['dormimur', 'dormiatur dormiamur dormamur dormiemur', 1], ['occupamini', 'occupeamini occupamini occupemini occupimini', 2],
      ['vincuntur', 'vinceantur vincentur vincintur vincantur', 3], ['clamor', 'clamar clamer clamear clamor', 1],
      ['videris', 'vidiaris vidaris videaris videris', 2], ['mittitur', 'mitteatur mittetur mittatur mittitur', 2],
      ['deficimur', 'deficiamur deficiamini deficiemur deficamur', 0], ['punimini', 'punamini puniamini punimini puniemini', 1],
      ['occiduntur', 'occidentur occidintur occidantur occideantur', 2],
    ]),
  ];

  const imperfect = [
    ...make('imperfect active', [
      ['amabam', 'amam amem amarem amares', 2], ['portabas', 'portaris portabas portabaris portares', 3],
      ['veniebat', 'veniretur veniret veniebat veniat', 1], ['monebamus', 'monebamus monebamur moneremus moneremur', 2],
      ['ducebatis', 'duceretis duceritis ducebant ducebamini', 0], ['capiebant', 'capierent caperentur caperent capiebant', 2],
      ['puniebam', 'punirim puniebam puniam punirem', 3], ['occupabas', 'occuparetis occupas occupabaris occupares', 3],
      ['docebat', 'doceretur docebat doceret docere', 2], ['cogebamus', 'cogebamus cogeremus cogamus cogeamus', 1],
      ['deficiebatis', 'deficiebamini deficiebatis deficeritis deficeretis', 3], ['muniebant', 'munirentur muniebant munirent muniant', 2],
    ]),
    ...make('present active', [
      ['amat', 'amant amatur amet ametur', 2], ['monemus', 'moneamus monemus moneamur monamus', 0],
      ['ducitis', 'ducitis ducatis ducamini ducetis', 1], ['sum', 'sis fuero essem sim', 3],
      ['possunt', 'possent possint poterint possunt', 1], ['vides', 'videaris videas vidis vidas', 1],
      ['audit', 'audiet audiat audit audet', 1], ['dormimus', 'dormiamus dormemus dormiemus dormamus', 0],
      ['pervenitis', 'pervenetis pervenitis pervenietis perveniatis', 3], ['currunt', 'currunt currint current currant', 3],
    ]),
    ...make('imperfect passive', [
      ['portabar', 'portarem portabar portarer portabam', 2], ['manetur', 'manemur maneret maneatur maneretur', 3],
      ['muniebamur', 'muniremur muniebamus muniemur muniremus', 0], ['currebamini', 'curreretis curreremini currebatis currebamini', 1],
      ['cogebantur', 'cogerent cogebant cogebantur cogerentur', 3], ['mittebatur', 'mitteretur mitterentur mitteret mitterent', 0],
      ['interficiebam', 'interficerem interficiem interficerer interficiebar', 2], ['discedebamini', 'discedetis discederemini discederetis discedebatis', 1],
      ['vulnerabamur', 'vulneraremur vulneramur vulnerabamus vulneraremus', 0], ['inveniebaris', 'invenireris inveniebaris invenires inveniebas', 0],
    ]),
    ...make('imperfect active', [
      ['eram', 'essem possum eram possam', 0], ['eras', 'esses eratis essetis eram', 0],
      ['erat', 'essem esset adesset posset', 1], ['eramus', 'essetis essem essemus esses', 2],
      ['eratis', 'esses eramini essetis essent', 2], ['erant', 'essent erant erint erunt', 0],
      ['poteram', 'posses possem possit possum', 1], ['poteras', 'poteratis possem possetis posses', 3],
      ['poterat', 'posset potesset possit poterat', 0], ['poteramus', 'possemus poterimus potsemus possimus', 0],
      ['poteratis', 'poterant possetis posses poteratis', 1], ['poterant', 'possunt possint possent possumus', 2],
    ]),
  ];

  window.BUILTIN_SETS = [
    { id: 'subjunctive-all', builtIn: true, title: 'Subjunctive Set', description: 'Every present and imperfect subjunctive question, all mixed together.', questions: [...present, ...imperfect] },
    { id: 'present-subjunctive', builtIn: true, title: 'Present Subjunctive', description: 'Latin 3: active and passive present subjunctive forms.', questions: present },
    { id: 'imperfect-subjunctive', builtIn: true, title: 'Imperfect Subjunctive', description: 'Latin 3: imperfect subjunctive, plus sum, possum and present review.', questions: imperfect },
  ];
})();
