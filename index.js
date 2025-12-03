require("dotenv").config();
const express = require("express");
const path = require('path');
const app = express();
const session = require("express-session");

const port = process.env.PORT || 3000;

// --- 1. MIDDLEWARE SETUP ---
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set("view engine", "ejs");

// --- 2. SESSION SETUP ---
app.use(
    session({
        secret: process.env.SESSION_SECRET || 'my-super-secret-key-12345',
        resave: false,
        saveUninitialized: false,
        cookie: { maxAge: 1000 * 60 * 60 * 24 }
    })
);

// --- 3. DATABASE CONNECTION ---
const knex = require("knex")({
    client: "pg",
    connection: {
        host: process.env.RDS_HOSTNAME || "postgres",
        user: process.env.RDS_USERNAME || "postgres",
        password: process.env.RDS_PASSWORD || "admin",
        database: process.env.RDS_NAME || "ellarises",
        port: process.env.RDS_PORT || 5432,
        ssl: process.env.DB_SSL ? {rejectUnauthorized: false} : false
    }
});

// for local use
// const knex = require("knex")({
//     client: "pg",
//     connection: {
//         host : process.env.DB_HOST || "localhost",
//         user : process.env.DB_USER || "postgres",
//         password : process.env.DB_PASSWORD || "admin1234",
//         database : process.env.DB_NAME || "ellarises",
//         port : process.env.DB_PORT || 5432  // PostgreSQL 16 typically uses port 5434
//     }
// });



// --- 4. CUSTOM MIDDLEWARE ---
const isLogged = (req, res, next) => {
    if (req.session.user) {
        res.locals.user = req.session.user;
        next();
    } else {
        res.redirect('/login');
    }
};

const isManager = (req, res, next) => {
    if (req.session.user && (req.session.user.role === 'manager' || req.session.user.role === 'admin')) {
        next();
    } else {
        res.status(403).send("Access Denied.");
    }
};

// --- ROUTES ---

// 1. Landing Page
app.get('/', (req, res) => {
    res.render('index', { 
        title: 'Home - Ella Rises', 
        user: req.session.user || null 
    });
});

// 2. Authentication
app.get('/login', (req, res) => {
    res.render('login', { title: 'Login', error: null });
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        // 소문자 컬럼명 사용 (participantemail)
        const user = await knex('participantinfo').where({ participantemail: email }).first();
        
        if (user && user.participantpassword === password) {
            req.session.user = {
                id: user.participantemail,
                role: user.participantrole // role도 소문자
            };
            req.session.save(() => res.redirect('/'));
        } else {
            res.render('login', { title: 'Login', error: 'Invalid email or password.' });
        }
    } catch (err) {
        console.error(err);
        res.render('login', { title: 'Login', error: 'Database error.' });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
});

// ==========================================
// --- SIGN UP ROUTES (Create User) ---
// ==========================================

// 1. 회원가입 페이지 보여주기 (GET)
app.get('/createUser', (req, res) => {
    res.render('createUser', { title: 'Create Account' });
});

// 2. 회원가입 로직 처리 (POST)
app.post('/createUser', async (req, res) => {
    const { firstName, lastName, email, password, role } = req.body;

    try {
        // ID 자동 생성 (가장 큰 번호 + 1)
        const maxIdResult = await knex('participantinfo').max('participantid as maxId').first();
        const nextId = (maxIdResult.maxId || 0) + 1;

        await knex('participantinfo').insert({
            participantid: nextId,
            participantfirstname: firstName,
            participantlastname: lastName,
            participantemail: email,
            participantpassword: password,
            participantrole: role || 'participant' // 기본값은 참여자
        });

        // 가입 성공 시 로그인 페이지로 이동
        res.send("<script>alert('Account created successfully! Please login.'); window.location.href='/login';</script>");
        
    } catch (err) {
        console.error("Create User Error:", err);
        res.status(500).send("Error creating account: " + err.message);
    }
});
// 3. User Maintenance
app.get('/users', isLogged, isManager, async (req, res) => {
    const search = req.query.search || '';
    try {
        const users = await knex('participantinfo')
            .where('participantemail', 'ilike', `%${search}%`) // 컬럼명 소문자
            .orderBy('participantid');
        
        res.render('users', { title: 'User Maintenance', users, search });
    } catch (err) { console.error(err); res.send(err.message); }
});
// ==========================================
// --- PARTICIPANTS ROUTES (전체 교체) ---
// ==========================================

// 1. 참가자 목록 조회 (검색 기능 포함)
app.get('/participants', isLogged, async (req, res) => {
    const search = req.query.search || '';
    try {
        const participants = await knex('participantinfo')
            .where(builder => {
                if (search) {
                    builder.where('participantfirstname', 'ilike', `%${search}%`)
                        .orWhere('participantlastname', 'ilike', `%${search}%`)
                        .orWhere('participantemail', 'ilike', `%${search}%`);
                }
            })
            .orderBy('participantid', 'asc');

        res.render('participants', { title: 'Participants', participants, search });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading participants.");
    }
});

// 2. 참가자 상세 보기 (View Details) - 마일스톤 추가됨
app.get('/participants/view/:id', isLogged, async (req, res) => {
    try {
        // 1. 참가자 기본 정보 조회
        const participant = await knex('participantinfo')
            .where({ participantid: req.params.id })
            .first();

        if (participant) {
            // 2. 해당 참가자의 마일스톤 조회 (Milestones 테이블과 조인)
            const milestones = await knex('participantmilestones')
                .join('milestones', 'participantmilestones.milestoneid', 'milestones.milestoneid')
                .select('milestones.milestonetitle', 'participantmilestones.milestonedate')
                .where('participantmilestones.participantid', req.params.id)
                .orderBy('participantmilestones.milestonedate', 'desc');

            // 뷰에 participant와 milestones 둘 다 전달
            res.render('participantDetail', { 
                title: 'Participant Details', 
                participant, 
                milestones 
            });
        } else {
            res.status(404).send("Participant not found.");
        }
    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading participant details.");
    }
});

// ✅ 3. 참가자 추가 페이지 (GET) - 이 부분이 없어서 에러가 난 것임!
app.get('/participants/add', isLogged, isManager, (req, res) => {
    res.render('addParticipant', { title: 'Add New Participant' });
});

// 4. 참가자 추가 로직 (POST)
app.post('/participants/add', isLogged, isManager, async (req, res) => {
    const { email, password, firstName, lastName, role, phone, city, state, zip } = req.body;
    try {
        // ID 자동 생성 (Max + 1)
        const maxIdResult = await knex('participantinfo').max('participantid as maxId').first();
        const nextId = (maxIdResult.maxId || 0) + 1;

        await knex('participantinfo').insert({
            participantid: nextId,
            participantemail: email,
            participantpassword: password, 
            participantfirstname: firstName,
            participantlastname: lastName,
            participantrole: role,
            participantphone: phone,
            participantcity: city,
            participantstate: state,
            participantzip: zip
        });
        res.redirect('/participants');
    } catch (err) {
        console.error(err);
        res.status(500).send("Error adding participant.");
    }
});

// ✅ 5. 참가자 수정 페이지 (GET) - 이 부분이 없어서 에러가 난 것임!
app.get('/participants/edit/:id', isLogged, isManager, async (req, res) => {
    try {
        const participant = await knex('participantinfo')
            .where({ participantid: req.params.id })
            .first();

        if (participant) {
            res.render('editParticipant', { title: 'Edit Participant', participant });
        } else {
            res.redirect('/participants');
        }
    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading participant for edit.");
    }
});

// 6. 참가자 수정 로직 (POST)
app.post('/participants/edit/:id', isLogged, isManager, async (req, res) => {
    const { email, firstName, lastName, role, phone, city, state, zip } = req.body;
    try {
        await knex('participantinfo')
            .where({ participantid: req.params.id })
            .update({
                participantemail: email,
                participantfirstname: firstName,
                participantlastname: lastName,
                participantrole: role,
                participantphone: phone,
                participantcity: city,
                participantstate: state,
                participantzip: zip
            });
        res.redirect('/participants');
    } catch (err) {
        console.error(err);
        res.status(500).send("Error updating participant.");
    }
});

// 7. 참가자 삭제 로직 (POST)
app.post('/participants/delete/:id', isLogged, isManager, async (req, res) => {
    try {
        await knex('participantinfo').where({ participantid: req.params.id }).del();
        res.redirect('/participants');
    } catch (err) {
        console.error(err);
        res.status(500).send("Error deleting participant.<br>Check for related records.");
    }
});


// 5. Events Maintenance
app.get('/events', isLogged, async (req, res) => {
    const search = req.query.search || '';
    const msg = req.query.msg;

    // Set up alert values (default null)
    let alertMessage = null;
    let alertType = "info";

    switch (msg) {
        case "registered":
            alertMessage = "You have successfully registered for the event!";
            alertType = "success";
            break;
        case "already":
            alertMessage = "You are already registered for this event.";
            alertType = "warning";
            break;
        case "nodate":
            alertMessage = "No upcoming event dates are available.";
            alertType = "secondary";
            break;
        case "notfound":
            alertMessage = "Participant record not found.";
            alertType = "danger";
            break;
        case "error":
            alertMessage = "An error occurred while processing your registration.";
            alertType = "danger";
            break;
    }

    try {
        const events = await knex('eventtemplates')
            .where('eventname', 'ilike', `%${search}%`)
            .orderBy('eventtemplateid');

        res.render('events', { 
            title: 'Events', 
            events, 
            search,
            alertMessage,   // <-- FIX
            alertType       // <-- FIX
        });

    } catch (err) { 
        console.error(err); 
        res.send(err.message); 
    }
});


// --- EVENTS: ADD & EDIT ROUTES ---

// 1. 이벤트 추가 페이지 보여주기 (GET)
app.get('/events/add', isLogged, isManager, (req, res) => {
    res.render('addEvent', { title: 'Add New Event' });
});

// 2. 이벤트 추가 로직 (POST) - ID 자동 계산 버전
app.post('/events/add', isLogged, isManager, async (req, res) => {
    const { eventName, eventType, eventRecurrence, eventDescription, eventCapacity } = req.body;

    try {
        // [1단계] 현재 DB에서 가장 큰 ID 번호를 조회합니다.
        // (DB 자동 생성기가 고장 났을 때를 대비한 안전장치)
        const result = await knex('eventtemplates').max('eventtemplateid as maxId').first();
        const nextId = (result.maxId || 0) + 1; // 기존 데이터가 없으면 1번, 있으면 (최대값+1)번

        // [2단계] 직접 계산한 nextId를 포함해서 저장합니다.
        await knex('eventtemplates').insert({
            eventtemplateid: nextId,  // ✅ 핵심: ID를 강제로 지정해서 넣음 (에러 방지)
            eventname: eventName,
            eventtype: eventType,
            eventrecurrencepattern: eventRecurrence,
            eventdescription: eventDescription,
            eventdefaultcapacity: eventCapacity
        });

        res.redirect('/events');
    } catch (err) {
        console.error("Error adding event:", err);
        res.status(500).send("Error adding event: " + err.message);
    }
});

// 3. 이벤트 수정 페이지 보여주기 (GET)
app.get('/events/edit/:id', isLogged, isManager, async (req, res) => {
    const eventId = req.params.id;
    try {
        const event = await knex('eventtemplates').where({ eventtemplateid: eventId }).first();
        if (event) {
            res.render('editEvent', { title: 'Edit Event', event });
        } else {
            res.redirect('/events');
        }
    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading event.");
    }
});

// 4. 이벤트 수정 로직 처리 (POST)
app.post('/events/edit/:id', isLogged, isManager, async (req, res) => {
    const eventId = req.params.id;
    const { eventName, eventType, eventRecurrence, eventDescription, eventCapacity } = req.body;

    try {
        await knex('eventtemplates')
            .where({ eventtemplateid: eventId })
            .update({
                eventname: eventName,
                eventtype: eventType,
                eventrecurrencepattern: eventRecurrence,
                eventdescription: eventDescription,
                eventdefaultcapacity: eventCapacity
            });
        res.redirect('/events');
    } catch (err) {
        console.error(err);
        res.status(500).send("Error updating event.");
    }
});
app.post('/events/delete/:id', isLogged, isManager, async (req, res) => {
    const eventId = req.params.id;

    try {
        // DB에서 삭제 시도
        // 주의: 이미 일정(EventOccurrences)이나 설문(Surveys)에 사용된 이벤트는 
        // 외래 키(Foreign Key) 제약 조건 때문에 삭제되지 않을 수 있습니다.
        await knex('eventtemplates')
            .where({ eventtemplateid: eventId })
            .del();
            
        res.redirect('/events');
    } catch (err) {
        console.error("Delete Error:", err);
        // 사용자에게 삭제 실패 이유 알림 (보통 데이터가 연결되어 있어서 삭제 못 함)
        res.status(500).send("Error deleting event. <br>This event might be linked to existing schedules or surveys.<br><a href='/events'>Go Back</a>");
    }
});




// 1. My Profile Page (Info, Milestones, Donations)
app.get('/profile', isLogged, async (req, res) => {
    const email = req.session.user.id; // User email from session

    try {
        // A. Get Basic Info
        const participant = await knex('participantinfo')
            .where({ participantemail: email })
            .first();

        if (!participant) return res.redirect('/logout');

        // B. Get My Milestones
        const myMilestones = await knex('participantmilestones')
            .join('milestones', 'participantmilestones.milestoneid', 'milestones.milestoneid')
            .select('milestones.milestonetitle', 'participantmilestones.milestonedate')
            .where({ participantid: participant.participantid })
            .orderBy('participantmilestones.milestonedate', 'desc');

        // C. Get My Donations
        const myDonations = await knex('participantdonations')
            .where({ participantid: participant.participantid })
            .orderBy('donationdate', 'desc');

        const myRegistrations = await knex('participantregistrations as pr')
            .join('eventoccurrences as eo', 'pr.eventoccurrenceid', 'eo.eventoccurrenceid')
            .join('eventtemplates as et', 'eo.eventtemplateid', 'et.eventtemplateid')
            .select(
                'pr.participantregistrationid',
                'et.eventname',
                'et.eventtype',
                'eo.eventdatetimestart',
                'pr.registrationstatus'
            )
            .where('pr.participantid', participant.participantid)
            .orderBy('eo.eventdatetimestart', 'desc');

        res.render('profile', {
            title: "My Profile",
            participant,
            myMilestones,
            myDonations,
            myRegistrations
        });

    } catch (err) {
        console.error("Profile Error:", err);
        res.status(500).send("Error loading profile.");
    }
});


// Deregister from an event
app.post('/profile/deregister/:registrationId', isLogged, async (req, res) => {
    const registrationId = req.params.registrationId;

    try {
        await knex('participantregistrations')
            .where({ participantregistrationid: registrationId })
            .del();

        res.redirect('/profile?msg=deregistered');

    } catch (err) {
        console.error("DEREG ERROR:", err);
        res.redirect('/profile?msg=error');
    }
});


// 2. Update My Profile (POST)
app.post('/profile/edit', isLogged, async (req, res) => {
    const email = req.session.user.id;
    const { firstName, lastName, phone, city, state, zip, password } = req.body;

    try {
        // Prepare update object
        const updateData = {
            participantfirstname: firstName,
            participantlastname: lastName,
            participantphone: phone,
            participantcity: city,
            participantstate: state,
            participantzip: zip
        };

        // Update password only if provided
        if (password && password.trim() !== "") {
            updateData.participantpassword = password;
        }

        await knex('participantinfo')
            .where({ participantemail: email })
            .update(updateData);

        res.redirect('/profile');
    } catch (err) {
        console.error("Profile Update Error:", err);
        res.status(500).send("Error updating profile.");
    }
});

// 3. Register for an Event (POST)
app.post('/events/register/:templateId', isLogged, async (req, res) => {
    const templateId = req.params.templateId;
    const email = req.session.user.id;

    try {
        // A. Find Participant Record
        const participant = await knex('participantinfo')
            .where({ participantemail: email })
            .first();

        if (!participant) {
            return res.redirect('/events?msg=notfound');
        }

        // B. Find Most Recent Event Occurrence
        const occurrence = await knex('eventoccurrences')
            .where({ eventtemplateid: templateId })
            .orderBy('eventdatetimestart', 'desc')
            .first();

        if (!occurrence) {
            return res.redirect('/events?msg=nodate');
        }

        // C. Check if Already Registered
        const existing = await knex('participantregistrations')
            .where({
                participantid: participant.participantid,
                eventoccurrenceid: occurrence.eventoccurrenceid
            })
            .first();

        if (existing) {
            return res.redirect('/events?msg=already');
        }

        // D. Create Registration
        await knex('participantregistrations').insert({
            participantid: participant.participantid,
            eventoccurrenceid: occurrence.eventoccurrenceid,
            registrationcreatedat: new Date(),
            registrationstatus: 'Registered',
            registrationattendedflag: null,
            registrationcheckintime: null
        });

        return res.redirect('/events?msg=registered');

    } catch (err) {
        console.error("Registration Error:", err);
        return res.redirect('/events?msg=error');
    }
});



app.get('/milestones', isLogged, async (req, res) => {
    const search = req.query.search || '';
    try {
        const milestones = await knex('milestones')
            .where('milestonetitle', 'ilike', `%${search}%`)
            .orderBy('milestoneid');
        res.render('milestones', { title: 'Milestones', milestones, search });
    } catch (err) { console.error(err); res.send(err.message); }
});

// ✅ 2. 마일스톤 상세 보기 (누가 달성했는지 조회)
app.get('/milestones/view/:id', isLogged, async (req, res) => {
    try {
        // (1) 마일스톤 정보 가져오기
        const milestone = await knex('milestones')
            .where({ milestoneid: req.params.id })
            .first();

        if (milestone) {
            // (2) 이 마일스톤을 달성한 참가자들 가져오기 (Join)
            const achievers = await knex('participantmilestones')
                .join('participantinfo', 'participantmilestones.participantid', 'participantinfo.participantid')
                .select(
                    'participantinfo.participantfirstname',
                    'participantinfo.participantlastname',
                    'participantinfo.participantemail',
                    'participantmilestones.milestonedate'
                )
                .where('participantmilestones.milestoneid', req.params.id)
                .orderBy('participantmilestones.milestonedate', 'desc');

            res.render('milestoneDetail', { title: 'Milestone Details', milestone, achievers });
        } else {
            res.status(404).send("Milestone not found.");
        }
    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading milestone details.");
    }
});

// ✅ 3. 마일스톤 추가 페이지 (GET)
app.get('/milestones/add', isLogged, isManager, (req, res) => {
    res.render('addMilestone', { title: 'Add New Milestone' });
});

// 4. 마일스톤 추가 로직 (POST)
app.post('/milestones/add', isLogged, isManager, async (req, res) => {
    const { title } = req.body;
    try {
        await knex('milestones').insert({
            milestonetitle: title
        });
        res.redirect('/milestones');
    } catch (err) { console.error(err); res.status(500).send("Error adding milestone."); }
});

// ✅ 5. 마일스톤 수정 페이지 (GET)
app.get('/milestones/edit/:id', isLogged, isManager, async (req, res) => {
    try {
        const milestone = await knex('milestones')
            .where({ milestoneid: req.params.id })
            .first();
        if (milestone) {
            res.render('editMilestone', { title: 'Edit Milestone', milestone });
        } else {
            res.redirect('/milestones');
        }
    } catch (err) { console.error(err); res.status(500).send("Error loading milestone."); }
});

// 6. 마일스톤 수정 로직 (POST)
app.post('/milestones/edit/:id', isLogged, isManager, async (req, res) => {
    const { title } = req.body;
    try {
        await knex('milestones')
            .where({ milestoneid: req.params.id })
            .update({ milestonetitle: title });
        res.redirect('/milestones');
    } catch (err) { console.error(err); res.status(500).send("Error updating milestone."); }
});

// 7. 마일스톤 삭제 로직 (POST)
app.post('/milestones/delete/:id', isLogged, isManager, async (req, res) => {
    try {
        await knex('milestones').where({ milestoneid: req.params.id }).del();
        res.redirect('/milestones');
    } catch (err) {
        console.error(err);
        res.status(500).send("Error deleting milestone. It may be assigned to participants.<br><a href='/milestones'>Go Back</a>");
    }
});
// --- SURVEYS ROUTES ---

// index.js

// 설문조사 목록 (검색 기능 추가됨)
app.get('/surveys', isLogged, async (req, res) => {
    const search = req.query.search || ''; // 검색어 가져오기

    try {
        const surveys = await knex('participantsurveys')
            .join('participantinfo', 'participantsurveys.participantid', 'participantinfo.participantid')
            .join('eventoccurrences', 'participantsurveys.eventoccurrenceid', 'eventoccurrences.eventoccurrenceid')
            .join('eventtemplates', 'eventoccurrences.eventtemplateid', 'eventtemplates.eventtemplateid')
            .select(
                'participantsurveys.participantsurveyid',
                'participantsurveys.surveysubmissiondate',
                'participantinfo.participantfirstname',
                'participantinfo.participantlastname',
                'eventtemplates.eventname',
                'eventoccurrences.eventdatetimestart as eventdate'
            )
            // ✅ 검색 로직 추가 (이름 또는 이벤트명)
            .modify((queryBuilder) => {
                if (search) {
                    queryBuilder
                        .where('participantinfo.participantfirstname', 'ilike', `%${search}%`)
                        .orWhere('participantinfo.participantlastname', 'ilike', `%${search}%`)
                        .orWhere('eventtemplates.eventname', 'ilike', `%${search}%`);
                }
            })
            .orderBy('participantsurveys.surveysubmissiondate', 'desc');

        // 뷰에 search 변수도 같이 전달 (검색창에 유지하기 위해)
        res.render('surveys', { title: 'Survey List', surveys, search });
    } catch (err) {
        console.error("Survey List Error:", err);
        res.status(500).send("Error loading surveys.");
    }
});

// 2. 설문조사 상세 보기 (수정됨: eventdate -> eventdatetimestart as eventdate)
app.get('/surveys/:id', isLogged, async (req, res) => {
    const surveyId = req.params.id;

    try {
        // A. 설문 헤더 정보
        const header = await knex('participantsurveys')
            .join('participantinfo', 'participantsurveys.participantid', 'participantinfo.participantid')
            .join('eventoccurrences', 'participantsurveys.eventoccurrenceid', 'eventoccurrences.eventoccurrenceid')
            .join('eventtemplates', 'eventoccurrences.eventtemplateid', 'eventtemplates.eventtemplateid')
            .select(
                'participantinfo.participantfirstname',
                'participantinfo.participantlastname',
                'eventtemplates.eventname',
                // ✅ 핵심 수정: 여기도 동일하게 변경
                'eventoccurrences.eventdatetimestart as eventdate'
            )
            .where('participantsurveys.participantsurveyid', surveyId)
            .first();

        // B. 상세 질문 및 답변
        const details = await knex('surveyresponses')
            .join('surveyquestions', 'surveyresponses.questionid', 'surveyquestions.questionid')
            .select('surveyquestions.question', 'surveyresponses.response')
            .where('surveyresponses.participantsurveyid', surveyId)
            .orderBy('surveyquestions.questionid');

        res.render('surveyDetail', { title: 'Survey Details', header, details });

    } catch (err) {
        console.error("Survey Detail Error:", err);
        res.status(500).send("Error loading survey details.");
    }
});
// index.js

// 8-B. Donation Maintenance (Admin View - Records & Total)
// index.js

app.get('/admin/donations', isLogged, isManager, async (req, res) => {
    const search = req.query.search || '';
    try {
        const donations = await knex('participantdonations')
            .join('participantinfo', 'participantdonations.participantid', 'participantinfo.participantid')
            .select(
                'participantdonations.*', 
                'participantinfo.participantemail', 
                'participantinfo.participantfirstname',
                'participantinfo.participantlastname'
            )
            .where(builder => {
                if(search) {
                    builder.where('participantinfo.participantfirstname', 'ilike', `%${search}%`)
                           .orWhere('participantinfo.participantlastname', 'ilike', `%${search}%`);
                }
            })
            // ✅ 수정된 부분: 세 번째 인자로 'last'를 추가하여 NULL 값을 맨 뒤로 보냅니다.
            .orderBy('donationdate', 'desc', 'last'); 

        const sumResult = await knex('participantdonations').sum('donationamount as total');
        const grandTotal = sumResult[0].total || 0;

        res.render('viewDonations', { 
            title: 'Donation Records', 
            donations, 
            search,
            grandTotal 
        });

    } catch (err) { 
        console.error(err); 
        res.status(500).send(err.message); 
    }
});

//Tableau Dashboard page
app.get('/dashboard', isLogged, isManager, async (req, res) => {
    res.render('dashboard', { 
        title: 'Dashboard', 
        error: null
    });
});


// 418 Teapot
app.get('/teapot', (req, res) => {
    res.status(418).render('teapot', { title: '418' });
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});