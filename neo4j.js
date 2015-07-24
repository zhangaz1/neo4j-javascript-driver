/*
 * Copyright (c) 2002-2015 "Neo Technology,"
 * Network Engine for Objects in Lund AB [http://neotechnology.com]
 *
 * This file is part of Neo4j.
 *
 * Neo4j is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

(function() {

    var MAX_CHUNK_SIZE = 16383,

        // Signature bytes for each message type
        INIT = 0x01,            // 0000 0001 // INIT <user_agent>
        ACK_FAILURE = 0x0F,     // 0000 1111 // ACK_FAILURE
        RUN = 0x10,             // 0001 0000 // RUN <statement> <parameters>
        DISCARD_ALL = 0x2F,     // 0010 1111 // DISCARD *
        PULL_ALL = 0x3F,        // 0011 1111 // PULL *
        SUCCESS = 0x70,         // 0111 0000 // SUCCESS <metadata>
        RECORD = 0x71,          // 0111 0001 // RECORD <value>
        IGNORED = 0x7E,         // 0111 1110 // IGNORED <metadata>
        FAILURE = 0x7F,         // 0111 1111 // FAILURE <metadata>

        NODE = 0x4E,
        RELATIONSHIP = 0x52,

        NULL = 0xC0,
        FLOAT_64 = 0xC1,
        FALSE = 0xC2,
        TRUE = 0xC3,
        INT_8 = 0xC8,
        INT_16 = 0xC9,
        INT_32 = 0xCA,
        INT_64 = 0xCB,
        TEXT_8 = 0xD0,
        TEXT_16 = 0xD1,
        TEXT_32 = 0xD2,
        LIST_8 = 0xD4,
        LIST_16 = 0xD5,
        LIST_32 = 0xD6,
        MAP_8 = 0xD8,
        MAP_16 = 0xD9,
        MAP_32 = 0xDA,
        STRUCT_8 = 0xDC,
        STRUCT_16 = 0xDD;

    function Structure(signature, fields) {
        this.signature = signature;
        this.fields = fields;
    }
    
    function Node(identity, labels, properties) {
        this.identity = identity;
        this.labels = labels;
        this.properties = properties;
        
        this.toString = function toString() {
            var s = "(" + this.identity.split('/')[1];
            for (var i = 0; i < this.labels.length; i++) {
                s += ":" + labels[i];
            }
            var keys = Object.keys(this.properties);
            if (keys.length > 0) {
                s += " {";
                for(var i = 0; i < keys.length; i++) {
                    if (i > 0) s += ",";
                    s += keys[i] + ":" + JSON.stringify(this.properties[keys[i]]);
                }
                s += "}";
            }
            s += ")";
            return s;
        }
    }

    function Relationship(identity, start, end, type, properties) {
        this.identity = identity;
        this.start = start;
        this.end = end;
        this.type = type;
        this.properties = properties;
        
        this.toString = function toString() {
            var s = "(" + this.start.split('/')[1] + ")-[:" + this.type;
            var keys = Object.keys(this.properties);
            if (keys.length > 0) {
                s += " {";
                for(var i = 0; i < keys.length; i++) {
                    if (i > 0) s += ",";
                    s += keys[i] + ":" + JSON.stringify(this.properties[keys[i]]);
                }
                s += "}";
            }
            s += "]->(" + this.end.split('/')[1] + ")";
            return s;
        }
    }

    function hydrate(x) {
        if (Array.isArray(x)) {
            for (var i = 0; i < x.length; i++) {
                x[i] = hydrate(x[i]);
            }
        } else if (x instanceof Structure) {
            fields = x.fields;
            switch(x.signature) {
            case NODE:
                x = new Node(fields[0], fields[1], fields[2]);
                break;
            case RELATIONSHIP:
                x = new Relationship(fields[0], fields[1], fields[2], fields[3], fields[4]);
                break;
            }
        }
        return x;
    }

    function Request(statement, parameters, onHeader, onRecord, onFooter) {
        this.statement = statement;
        this.parameters = parameters;
        this.onHeader = onHeader;
        this.onRecord = onRecord;
        this.onFooter = onFooter;
    }

    function ResponseHandler(summaryHandler, detailHandler) {
        this.summaryHandler = summaryHandler;
        this.detailHandler = detailHandler;
    }
        
    function Message(ws) {
        var data = [],
            size = 0;
        
        function flush() {
            ws.send(new Uint8Array([size/256>>0, size%256]));
            for(var i = 0; i < data.length; i++) {
                ws.send(data[i]);
            }
            data = [];
            size = 0;
        }
        
        this.write = function write(b) {
            // TODO: when b > MAX_CHUNK_SIZE
            var newSize = size + b.length;
            if (newSize >= MAX_CHUNK_SIZE) {
                flush();
            }
            data.push(b);
            size += b.length;
        }

        this.end = function end() {
            flush();
            ws.send(new Uint8Array([0, 0]));
        }
        
    }

    function Packer(msg) {

        var encoder = new TextEncoder();

        this.pack = function pack(value) {
            if (typeof(value) == "string") {
                packText(value);
            } else if (value instanceof Structure) {
                packStructHeader(value.fields.length, value.signature);
                for(var i = 0; i < value.fields.length; i++) {
                    pack(value.fields[i]);
                }
            } else if (typeof(value) == "object") {
                var keys = Object.keys(value);
                packMapHeader(keys.length);
                for(var key in keys) {
                    packText(key);
                    pack(value[key]);
                }
            } else {
                // TODO
                log("BAD THING 1!");
            }
        }
        
        function packText(value) {
            var bytes = encoder.encode(value);
            var size = bytes.length;
            if (size < 16) {
                msg.write(new Uint8Array([0x80 | size]));
                msg.write(bytes);
            } else if (size < 256) {
                msg.write(new Uint8Array([0xD0, size]));
                msg.write(bytes);
            } else {
                // TODO
                log("BAD THING 2!");
            }
        }
        
        function packMapHeader(size) {
            if (size < 16) {
                msg.write(new Uint8Array([0xA0 | size]));
            } else {
                // TODO
                log("BAD THING 3!");
            }
        }
        
        function packStructHeader(size, signature) {
            if (size < 16) {
                msg.write(new Uint8Array([0xB0 | size, signature]));
            } else {
                // TODO
                log("BAD THING 4!");
            }
        }
        
        var bytes = function bytes() {
            return Uint8Array(data);
        }

    }

    function Unpacker(data) {
        var p = 0,
            decoder = new TextDecoder();
        
        function read() {
            var ch = data[p];
            p += 1;
            return ch;
        }
        
        function readUint16() {
            var q = p;
            readBytes(2);
            return new DataView(data.buffer).getUint16(q);
        }
        
        function readUint32() {
            var q = p;
            readBytes(4);
            return new DataView(data.buffer).getUint32(q);
        }
        
        function readUint64() {
            var q = p;
            readBytes(8);
            return new DataView(data.buffer).getUint64(q);
        }
        
        function readBytes(n) {
            var q = p + n,
                s = data.subarray(p, q);
            p = q;
            return s;
        }

        function readList(size) {
            var value = [];
            for(var i = 0; i < size; i++)
                value.push(unpack());
            return value;
        }

        function readMap(size) {
            var value = {};
            for(var i = 0; i < size; i++) {
                var key = unpack();
                value[key] = unpack();
            }
            return value;
        }

        function readStruct(size) {
            var signature = read(),
                value = new Structure(signature, []);
            for(var i = 0; i < size; i++) {
                value.fields.push(unpack());
            }
            return value;
        }

        function unpack() {
            var marker = read(), q = p;
            if (marker >= 0 && marker < 128) {
                return marker;
            } else if (marker >= 240 && marker < 256) {
                return marker - 256;
            } else if (marker == NULL) {
                return null;
            } else if (marker == TRUE) {
                return true;
            } else if (marker == FALSE) {
                return false;
            } else if (marker == FLOAT_64) {
                readBytes(8);
                return new DataView(data.buffer).getFloat64(q);
            } else if (marker == INT_8) {
                readBytes(1);
                return new DataView(data.buffer).getInt8(q);
            } else if (marker == INT_16) {
                readBytes(2);
                return new DataView(data.buffer).getInt16(q);
            } else if (marker == INT_32) {
                readBytes(4);
                return new DataView(data.buffer).getInt32(q);
            } else if (marker == INT_64) {
                readBytes(8);
                return new DataView(data.buffer).getInt64(q);
            } else if (marker == TEXT_8) {
                var size = read();
                return decoder.decode(readBytes(size));
            } else if (marker == TEXT_16) {
                var size = readUint16();
                return decoder.decode(readBytes(size));
            } else if (marker == TEXT_32) {
                var size = readUint32();
                return decoder.decode(readBytes(size));
            } else if (marker == LIST_8) {
                return readList(read());
            } else if (marker == LIST_16) {
                return readList(readUint16());
            } else if (marker == LIST_32) {
                return readList(readUint32());
            } else if (marker == MAP_8) {
                return readMap(read());
            } else if (marker == MAP_16) {
                return readMap(readUint16());
            } else if (marker == MAP_32) {
                return readMap(readUint32());
            } else if (marker == STRUCT_8) {
                return readStruct(read());
            } else if (marker == STRUCT_16) {
                return readStruct(readUint16());
            }
            var markerHigh = marker & 0xF0;
            if (markerHigh == 0x80) {
                var size = marker & 0x0F;
                return decoder.decode(readBytes(size));
            } else if (markerHigh == 0x90) {
                return readList(marker & 0x0F);
            } else if (markerHigh == 0xA0) {
                return readMap(marker & 0x0F);
            } else if (markerHigh == 0xB0) {
                return readStruct(marker & 0x0F);
            } else {
                log("UNPACKABLE: " + marker.toString(16));
            }
        }
        this.unpack = unpack;

    }

    function Session(onReady) {
        var receiver = null,
            responseHandlers = [],
            ready = false,
            requests = [];

        function handshake() {
            log("C: [HANDSHAKE] [1, 0, 0, 0]");
            receiver = function(data) {
                var version = new DataView(data).getUint32(0);
                log("S: [HANDSHAKE] " + version);
                if (version == 1) {
                    receiver = receiverV1;
                    init();
                } else {
                    log("UNKNOWN PROTOCOL VERSION " + version);
                }
            }
            ws.send(new Uint8Array([0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0]));
        }

        function send(signature, fields, summaryHandler, detailHandler) {
            responseHandlers.push(new ResponseHandler(summaryHandler, detailHandler));
            packer.pack(new Structure(signature, fields));
            msg.end();
        }
        
        function recv(data) {
            log("S: " + data);
            if (receiver) receiver(data);
        }

        function onMessage(data) {
            var unpacker = new Unpacker(data),
                message = unpacker.unpack();
            switch(message.signature) {
            case SUCCESS:
                log("S: SUCCESS " + JSON.stringify(message.fields[0]));
                var handler = responseHandlers.shift().summaryHandler;
                if(handler) handler(true, message.fields[0]);
                break;
            case FAILURE:
                log("S: FAILURE " + JSON.stringify(message.fields[0]));
                var handler = responseHandlers.shift().summaryHandler;
                if(handler) handler(false, message.fields[0]);
                break;
            case IGNORED:
                log("S: IGNORED " + JSON.stringify(message.fields[0]));
                var handler = responseHandlers.shift().summaryHandler
                if(handler) handler(null, message.fields[0]);
                break;
            case RECORD:
                log("S: RECORD " + JSON.stringify(message.fields[0]));
                var handler = responseHandlers[0].detailHandler;
                if(handler) handler(hydrate(message.fields[0]));
                break;
            default:
                log("WTF");
            }
        }

        var messageData = new Uint8Array();
        function onChunk(data) {
            if (data.length == 0) {
                onMessage(messageData);
                messageData = new Uint8Array();
            } else {
                var newData = new Uint8Array(messageData.length + data.length);
                newData.set(messageData);
                newData.set(data, messageData.length);
                messageData = newData;
            }
        }
        
        function receiverV1(data) {
            var p = 0;
            while (p < data.byteLength) {
                var q = p + 2,
                    chunkSize = new DataView(data.slice(p, q)).getUint16(0);
                p = q + chunkSize;
                onChunk(new Uint8Array(data.slice(q, p)));
            }
            
        }

        function init() {
            var userAgent = "neo4j-javascript/0.0";
            log("C: INIT " + JSON.stringify(userAgent));
            send(INIT, [userAgent], function(success) {
                if(success) {
                    ready = true;
                    runNext();
                }
            });
        }

        this.run = function run(statement, parameters, onRecord, onHeader, onFooter) {
            requests.push(new Request(statement, parameters, onHeader, onRecord, onFooter));
            runNext();
        }
        
        function runNext() {
            if (ready) {
                var rq = requests.shift();
                if (rq) {
                    ready = false;
                    log("C: RUN " + JSON.stringify(rq.statement) + " " + JSON.stringify(rq.parameters));
                    send(RUN, [rq.statement, rq.parameters], rq.onHeader);
                    log("C: PULL_ALL");
                    send(PULL_ALL, [], function(metadata) {
                        if (rq.onfooter) rq.onFooter(metadata);
                        ready = true;
                    }, rq.onRecord);
                }
            }
        }

        var ws = new WebSocket("ws://localhost:7688/"),
            msg = new Message(ws);
            packer = new Packer(msg);
        ws.onmessage = function(event) {
            var reader = new FileReader();
            reader.addEventListener("loadend", function() {
                recv(reader.result);
            });
            reader.readAsArrayBuffer(event.data);
        };
        ws.onopen = function(event) {
            handshake();
        };

    }

    function log(obj) {
        var el = document.getElementById("log");
        el.appendChild(document.createTextNode(obj.toString()));
        el.appendChild(document.createElement("br"));
    }

    // Expose the 'Session' class
    window.Session = Session;

}());
