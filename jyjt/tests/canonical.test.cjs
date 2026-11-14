// Node.js | 24+ | CommonJS
// Build: none; canonical standalone scripts only.
// Run: node --test jyjt/tests/canonical.test.cjs
// Deps: built-in node:test/vm; all network APIs mocked.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { root, runSurge, parity, text, commonContext, commonModules, nativeParts, sections, evaluateRule } = require('../../egern/tests/canonical-fixture.cjs');
const soapURL='http://smoke.nxnresearch.com/webservice510.asmx';
const soap='<soap:Envelope><soap:Body><response>{"member_flg" : 0, "user_type":0,"member_end_date":null,"unknown":"keep"}</response></soap:Body></soap:Envelope>';
test('SOAP modifies only complete zero/null values and retains XML',async()=>{const result=await parity(15,soapURL,soap,{method:'POST',binary:true});const output=text(result.body);assert.match(output,/"member_flg" : 1/);assert.match(output,/"member_end_date":"2099-12-31"/);assert.match(output,/<soap:Envelope>/);assert.match(output,/"unknown":"keep"/);});
test('SOAP fractional numeric values and existing dates are not broadened',async()=>{const input=soap.replace('"member_flg" : 0','"member_flg" : 0.5').replace('"user_type":0','"user_type":0e2').replace('null','"2027-01-01"');const result=await parity(15,soapURL,input,{method:'POST'});assert.equal(result.result.body,undefined);});
test('SOAP Fault and HTTP errors bypass',async()=>{for(const [input,options] of [[soap.replace('<soap:Body>','<soap:Body><soap:Fault>error</soap:Fault>'),{}],[soap,{status:500}]]){const result=await parity(15,soapURL,input,{method:'POST',...options});assert.equal(result.result.body,undefined);}});
test('SOAP non-target/HTTPS and unsupported XML encoding bypass',()=>{for(const url of [soapURL+'Extra','https://smoke.nxnresearch.com/webservice510.asmx','http://other.example/webservice510.asmx'])assert.equal(runSurge(15,url,soap,{method:'POST'}).result.body,undefined);assert.equal(runSurge(15,soapURL,'<?xml version="1.0" encoding="GBK"?>'+soap,{method:'POST'}).result.body,undefined);});
