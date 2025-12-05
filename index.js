// INTEX ELLA RISES
// Group 8, Section 3
// Bailie Whetton, Josh McCauley, Jaewon Shim, Ryan Skyles
// Index.js page


// Load environment variables
require("dotenv").config();
const express = require("express");
const path = require('path');
const app = express();
const session = require("express-session");

const port = process.env.PORT || 3000;

// -----------------------------------------
// 1. MIDDLEWARE SETUP
// -----------------------------------------
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set("view engine", "ejs");

// -----------------------------------------
// 2. SESSION SETUP
// -----------------------------------------
app.use(
    session({
        secret: process.env.SESSION_SECRET || 'my-super-secret-key-12345',
        resave: false,
        saveUninitialized: false,
        cookie: { maxAge: 1000 * 60 * 60 * 24 }
    })
);

// -----------------------------------------
// 3. DATABASE CONNECTION
// -----------------------------------------
const knex = require("knex")({
    client: "pg",
    connection: {
        host: process.env.RDS_HOSTNAME || "postgres",
        user: process.env.RDS_USERNAME || "postgres",
        password: process.env.RDS_PASSWORD || "admin1234",
        database: process.env.RDS_NAME || "ebdb",
        port: process.env.RDS_PORT || 5432,
        ssl: process.env.DB_SSL ? { rejectUnauthorized: false } : false
    }
});

// -----------------------------------------
// 4. CUSTOM MIDDLEWARE
// -----------------------------------------

// Checks if user is logged in
const isLogged = (req, res, next) => {
    if (req.session.user) {
        res.locals.user = req.session.user;
        next();
    } else {
        res.redirect('/login');
    }
};

// Checks if user is manager or admin
const isManager = (req, res, next) => {
    if (req.session.user && (req.session.user.role === 'manager' || req.session.user.role === 'admin')) {
        next();
    } else {
        res.status(403).send("Access Denied.");
    }
};

// -----------------------------------------
// ROUTES
// -----------------------------------------

// Landing Page
app.get('/', (req, res) => {
    res.render('index', {
        title: 'Home - Ella Rises',
        user: req.session.user || null
    });
});

// -----------------------------------------
// AUTHENTICATION ROUTES
// -----------------------------------------

app.get('/login', (req, res) => {
    res.render('login', { title: 'Login', error: null });
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await knex('participantinfo').where({ participantemail: email }).first();

        if (user && user.participantpassword === password) {
            req.session.user = {
                id: user.participantemail,
                participantid: user.participantid,
                role: user.participantrole
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

// -----------------------------------------
// ADMIN: REGISTER USER FOR EVENT
// -----------------------------------------

// Display registration page
app.get('/admin/register-event', isLogged, isManager, async (req, res) => {
    try {
        // Fetch participants
        const participants = await knex('participantinfo')
            .select('participantid', 'participantfirstname', 'participantlastname', 'participantemail')
            .orderBy('participantfirstname');

        // Fetch events
        const events = await knex('eventoccurrences')
            .join('eventtemplates', 'eventoccurrences.eventtemplateid', 'eventtemplates.eventtemplateid')
            .select(
                'eventoccurrences.eventoccurrenceid',
                'eventtemplates.eventname',
                'eventoccurrences.eventdatetimestart',
                'eventoccurrences.eventlocation'
            )
            .orderBy('eventoccurrences.eventdatetimestart', 'desc');

        res.render('registerUserEvent', { title: 'Register User for Event', participants, events });
    } catch (err) {
        console.error("Load Register Page Error:", err);
        res.status(500).send("Error loading registration page.");
    }
});

// Handle participant registration
app.post('/admin/register-event', isLogged, isManager, async (req, res) => {
    const { participantId, eventOccurrenceId } = req.body;

    if (!participantId || !eventOccurrenceId) {
        return res.send("<script>alert('Please select both a participant and an event.'); window.history.back();</script>");
    }

    try {
        // Prevent duplicate registration
        const existing = await knex('participantregistrations')
            .where({ participantid: participantId, eventoccurrenceid: eventOccurrenceId })
            .first();

        if (existing) {
            return res.send("<script>alert('This user is already registered for this event.'); window.history.back();</script>");
        }

        // Manually generate next registration ID
        const maxIdResult = await knex('participantregistrations').max('participantregistrationid as maxId').first();
        const nextId = (maxIdResult.maxId || 0) + 1;

        // Insert registration record
        await knex('participantregistrations').insert({
            participantregistrationid: nextId,
            participantid: participantId,
            eventoccurrenceid: eventOccurrenceId,
            registrationcreatedat: new Date(),
            registrationstatus: 'Registered'
        });

        res.send("<script>alert('Registration Successful!'); window.location.href='/participants';</script>");
    } catch (err) {
        console.error("Admin Register Error:", err);
        res.status(500).send("Error registering user: " + err.message);
    }
});

// -----------------------------------------
// USER ACCOUNT CREATION
// -----------------------------------------

app.get('/createUser', (req, res) => {
    res.render('createUser', { title: 'Create Account' });
});

app.post('/createUser', async (req, res) => {
    const { firstName, lastName, email, password, role } = req.body;

    try {
        const maxIdResult = await knex('participantinfo').max('participantid as maxId').first();
        const nextId = (maxIdResult.maxId || 0) + 1;

        await knex('participantinfo').insert({
            participantid: nextId,
            participantfirstname: firstName,
            participantlastname: lastName,
            participantemail: email,
            participantpassword: password,
            participantrole: role || 'participant'
        });

        res.send("<script>alert('Account created successfully! Please login.'); window.location.href='/login';</script>");
    } catch (err) {
        console.error("Create User Error:", err);
        res.status(500).send("Error creating account: " + err.message);
    }
});

// -----------------------------------------
// USER MAINTENANCE (ADMIN)
// -----------------------------------------

app.get('/participants', isLogged, isManager, async (req, res) => {
    const search = req.query.search || '';
    try {
        const users = await knex('participantinfo')
            .where('participantemail', 'ilike', `%${search}%`)
            .orderBy('participantid');

        res.render('users', { title: 'User Maintenance', users, search });
    } catch (err) {
        console.error(err);
        res.send(err.message);
    }
});

// -----------------------------------------
// PARTICIPANT DIRECTORY
// -----------------------------------------

app.get('/participants', isLogged, async (req, res) => {
    const search = req.query.search || '';
    try {
        const participants = await knex('participantinfo')
            .where(builder => {
                if (search) {
                    const term = `%${search}%`;
                    builder.where('participantfirstname', 'ilike', term)
                        .orWhere('participantlastname', 'ilike', term)
                        .orWhere('participantemail', 'ilike', term)
                        .orWhereRaw("participantfirstname || ' ' || participantlastname ILIKE ?", [term]);
                }
            })
            .orderBy('participantid', 'asc');

        res.render('participants', { title: 'Participants', participants, search });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading participants.");
    }
});

// Display Add Participant Page
app.get('/participants/add', isLogged, isManager, (req, res) => {
    res.render('addParticipant', { title: 'Add New Participant' });
});

// Handle Add Participant
app.post('/participants/add', isLogged, isManager, async (req, res) => {
    const { email, password, firstName, lastName, role, phone, city, state, zip } = req.body;
    try {
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
        res.status(500).send("Error updating participant.");
    }
});

// 7. Delete Participant (POST)
app.post('/participants/delete/:id', isLogged, isManager, async (req, res) => {
    try {
        await knex('participantinfo').where({ participantid: req.params.id }).del();
        res.redirect('/participants');
    } catch (err) {
        console.error(err);
        res.status(500).send("Error deleting participant.<br>Check for related records.");
    }
});

// ADMIN: Milestones Add / Edit / Delete

// Add Milestone (Admin)
app.post('/admin/milestones/add', isLogged, isManager, async (req, res) => {
    const { participantid, milestoneid, milestonedate } = req.body;

    await knex('participantmilestones').insert({
        participantid,
        milestoneid,
        milestonedate: milestonedate || null
    });

    res.redirect(`/users/view/${participantid}`);
});

// Edit Milestone (Admin)
app.post('/admin/milestones/edit/:id', isLogged, isManager, async (req, res) => {
    const participantMilestoneId = req.params.id;
    const { milestoneid, milestonedate, participantid } = req.body;

    await knex('participantmilestones')
        .where({ participantmilestoneid: participantMilestoneId })
        .update({
            milestoneid,
            milestonedate: milestonedate || null
        });

    res.redirect(`/users/view/${participantid}`);
});

// Delete Milestone (Admin)
app.post('/admin/milestones/delete/:id', isLogged, isManager, async (req, res) => {
    const participantMilestoneId = req.params.id;
    const participant = req.query.participant;

    await knex('participantmilestones')
        .where({ participantmilestoneid: participantMilestoneId })
        .del();

    res.redirect(`/users/view/${participant}`);
});

// ------------------------------------------------------------
// Events Maintenance
// ------------------------------------------------------------

// View all events
app.get('/events', isLogged, async (req, res) => {
    const search = req.query.search || '';
    const msg = req.query.msg;

    // Alert message defaults
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
            alertMessage,
            alertType
        });

    } catch (err) {
        console.error(err);
        res.send(err.message);
    }
});

// Show "Add Event Date" Page
app.get('/events/addDate', isLogged, async (req, res) => {
    try {
        const events = await knex('eventtemplates').orderBy('eventtemplateid');
        res.render('editEventDate', { title: 'Add Event Date', events });
    } catch (err) {
        console.error(err);
        res.send(err.message);
    }
});

// Submit New Event Date
app.post('/events/addDate', isLogged, async (req, res) => {
    const { eventTemplateId, eventDateTimeStart, eventDateTimeEnd, eventLocation, eventCapacity, eventRegistrationDeadline } = req.body;

    try {
        await knex('eventoccurrences').insert({
            eventtemplateid: eventTemplateId,
            eventdatetimestart: eventDateTimeStart,
            eventdatetimeend: eventDateTimeEnd,
            eventlocation: eventLocation,
            eventcapacity: eventCapacity,
            eventregistrationdeadline: eventRegistrationDeadline || null
        });
        res.redirect('/events?msg=added');
    } catch (err) {
        console.error(err);
        res.send(err.message);
    }
});

// ------------------------------------------------------------
// Event Template Add / Edit / Delete (Admin)
// ------------------------------------------------------------

// Show Add Event Page
app.get('/events/add', isLogged, isManager, (req, res) => {
    res.render('addEvent', { title: 'Add New Event' });
});

// Add Event (Admin) - Manual ID fallback
app.post('/events/add', isLogged, isManager, async (req, res) => {
    const { eventName, eventType, eventRecurrence, eventDescription, eventCapacity } = req.body;

    try {
        // Safety check: manually compute next ID if database auto-increment fails
        const result = await knex('eventtemplates').max('eventtemplateid as maxId').first();
        const nextId = (result.maxId || 0) + 1;

        await knex('eventtemplates').insert({
            eventtemplateid: nextId,
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

// Show Edit Event Page
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

// Submit Event Update
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

// Delete Event (Admin)
app.post('/events/delete/:id', isLogged, isManager, async (req, res) => {
    const eventId = req.params.id;

    try {
        // Deleting may fail if the event is linked to occurrences or surveys
        await knex('eventtemplates')
            .where({ eventtemplateid: eventId })
            .del();

        res.redirect('/events');
    } catch (err) {
        console.error("Delete Error:", err);
        res.status(500).send(
            "Error deleting event.<br>This event may be linked to existing schedules or surveys.<br><a href='/events'>Go Back</a>"
        );
    }
});





// 1. My Profile Page (Info, Milestones, Donations)
app.get('/profile', isLogged, async (req, res) => {
    const email = req.session.user.id;

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

        // D. Get UPCOMING EVENTS
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
            .andWhere('eo.eventdatetimestart', '>=', knex.fn.now())
            .orderBy('eo.eventdatetimestart', 'asc');

        // E. Get PAST EVENTS
        const pastEvents = await knex('participantregistrations as pr')
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
            .andWhere('eo.eventdatetimestart', '<', knex.fn.now())
            .orderBy('eo.eventdatetimestart', 'desc');


        res.render('profile', {
            title: "My Profile",
            participant,
            myMilestones,
            myDonations,
            myRegistrations,
            pastEvents      
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


// Show "Add Milestone" page for the logged-in user
app.get("/user/milestones/add", isLogged, async (req, res) => {
    try {
        const milestones = await knex("milestones")
            .select("*")
            .orderBy("milestoneid");

        res.render("addMilestoneUser", {
            title: "Add Milestone",
            milestones
        });

    } catch (err) {
        console.error("Error loading milestones:", err);
        res.send("Error loading milestones");
    }
});


// Save a new milestone for the logged-in user
app.post("/user/milestones/add", isLogged, async (req, res) => {
    const participantid = req.session.user.participantid;
    const { milestoneid, milestonedate } = req.body;

    console.log("Form data received:", req.body); // Debugging

    // Validate input
    if (!milestoneid || !milestonedate) {
        return res.send("<script>alert('Please select a milestone and a date.'); window.history.back();</script>");
    }

    try {
        // Count how many milestones the user already has
        const countResult = await knex("participantmilestones")
            .where({ participantid })
            .count("* as count")
            .first();

        const nextmilestoneno = Number(countResult.count) + 1;

        // Insert new milestone
        await knex("participantmilestones").insert({
            participantid,
            milestoneid: Number(milestoneid),
            milestonedate,      // YYYY-MM-DD format
            milestoneno: nextmilestoneno
        });

        res.redirect("/profile?newMilestone=1"); // redirect to user profile page

    } catch (err) {
        console.error("Error saving milestone:", err);
        res.send("Error saving milestone");
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

app.post('/events/registerOccurrence/:occurrenceId', isLogged, async (req, res) => {
    const occurrenceId = req.params.occurrenceId;
    const email = req.session.user.id;

    try {
        // A. Find Participant
        const participant = await knex('participantinfo')
            .where({ participantemail: email })
            .first();

        if (!participant) {
            return res.status(400).send("Participant not found.");
        }

        // B. Check Occurrence Exists
        const occurrence = await knex('eventoccurrences')
            .where({ eventoccurrenceid: occurrenceId })
            .first();

        if (!occurrence) {
            return res.status(400).send("Event occurrence not found.");
        }

        // C. Check if Already Registered
        const existing = await knex('participantregistrations')
            .where({
                participantid: participant.participantid,
                eventoccurrenceid: occurrenceId
            })
            .first();

        if (existing) {
            return res.status(400).send("You are already registered.");
        }

        // D. Register the participant
        await knex('participantregistrations').insert({
            participantid: participant.participantid,
            eventoccurrenceid: occurrenceId,
            registrationcreatedat: new Date(),
            registrationstatus: 'Registered'
        });

        return res.send("Successfully registered!");

    } catch (err) {
        console.error("Registration Error:", err);
        return res.status(500).send("Error registering for event.");
    }
});


// Display the event calendar page
app.get('/events/calendar/:templateId', isLogged, async (req, res) => {
    const templateId = req.params.templateId;

    try {
        const template = await knex('eventtemplates')
            .where('eventtemplateid', templateId)
            .first();

        res.render('eventCalendar', {
            title: template?.eventname || 'Event Calendar',
            templateId
        });

    } catch (err) {
        console.error(err);
        res.redirect('/events?msg=error');
    }
});


// Return JSON event data associated with a template
app.get('/events/calendarData/:templateId', isLogged, async (req, res) => {
    const templateId = req.params.templateId;

    try {
        const rawEvents = await knex('eventoccurrences')
            .join('eventtemplates', 'eventoccurrences.eventtemplateid', 'eventtemplates.eventtemplateid')
            .where('eventoccurrences.eventtemplateid', templateId)
            .select(
                'eventoccurrences.eventoccurrenceid',
                'eventtemplates.eventname',
                'eventoccurrences.eventdatetimestart',
                'eventoccurrences.eventdatetimeend',
                'eventoccurrences.eventlocation'
            );

        const events = rawEvents.map(e => ({
            id: e.eventoccurrenceid,
            title: e.eventname,
            start: e.eventdatetimestart,
            end: e.eventdatetimeend,
            location: e.eventlocation
        }));

        res.json(events);

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error loading events" });
    }
});


// Admin: View milestones list
app.get('/milestones', isLogged, async (req, res) => {
    const search = req.query.search || '';
    try {
        const milestones = await knex('milestones')
            .where('milestonetitle', 'ilike', `%${search}%`)
            .orderBy('milestoneid');

        // Count all milestone achievements
        const [{ count }] = await knex('participantmilestones').count('*');

        res.render('milestones', { 
            title: 'Milestones', 
            milestones, 
            search,
            totalMilestonesAchieved: count
        });
    } catch (err) { 
        console.error(err); 
        res.send(err.message); 
    }
});


// View details for a specific milestone, including participants who achieved it
app.get('/milestones/view/:id', isLogged, async (req, res) => {
    try {
        const milestone = await knex('milestones')
            .where({ milestoneid: req.params.id })
            .first();

        if (milestone) {
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

            res.render('milestoneDetail', { 
                title: 'Milestone Details', 
                milestone, 
                achievers 
            });
        } else {
            res.status(404).send("Milestone not found.");
        }
    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading milestone details.");
    }
});


// Display page for adding a new milestone
app.get('/milestones/add', isLogged, isManager, (req, res) => {
    res.render('addMilestone', { title: 'Add New Milestone' });
});


// Handle milestone creation
app.post('/milestones/add', isLogged, isManager, async (req, res) => {
    const { title } = req.body;
    try {
        await knex('milestones').insert({
            milestonetitle: title
        });
        res.redirect('/milestones');
    } catch (err) { 
        console.error(err); 
        res.status(500).send("Error adding milestone."); 
    }
});


// Display milestone edit page
app.get('/milestones/edit/:id', isLogged, isManager, async (req, res) => {
    try {
        const milestone = await knex('milestones')
            .where({ milestoneid: req.params.id })
            .first();

        if (milestone) {
            res.render('editMilestone', { 
                title: 'Edit Milestone', 
                milestone 
            });
        } else {
            res.redirect('/milestones');
        }
    } catch (err) { 
        console.error(err); 
        res.status(500).send("Error loading milestone."); 
    }
});


// Handle milestone update
app.post('/milestones/edit/:id', isLogged, isManager, async (req, res) => {
    const { title } = req.body;
    try {
        await knex('milestones')
            .where({ milestoneid: req.params.id })
            .update({ milestonetitle: title });
        res.redirect('/milestones');
    } catch (err) { 
        console.error(err); 
        res.status(500).send("Error updating milestone."); 
    }
});


// Handle milestone deletion
app.post('/milestones/delete/:id', isLogged, isManager, async (req, res) => {
    try {
        await knex('milestones')
            .where({ milestoneid: req.params.id })
            .del();
        res.redirect('/milestones');
    } catch (err) {
        console.error(err);
        res.status(500).send("Error deleting milestone. It may be assigned to participants.<br><a href='/milestones'>Go Back</a>");
    }
});

// ==========================================
// USER MAINTENANCE ROUTES (Admin)
// ==========================================

// Display user list with optional search
app.get('/users', isLogged, isManager, async (req, res) => {
    const search = req.query.search || '';
    try {
        const users = await knex('participantinfo')
            .where(builder => {
                if (search) {
                    const term = `%${search}%`;
                    builder.where('participantfirstname', 'ilike', term)
                        .orWhere('participantlastname', 'ilike', term)
                        .orWhere('participantemail', 'ilike', term)
                        .orWhereRaw("participantfirstname || ' ' || participantlastname ILIKE ?", [term]);
                }
            })
            .orderBy('participantid', 'asc');

        res.render('users', { title: 'User Maintenance', users, search });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading users.");
    }
});


// Display details for a specific user (profile, events, milestones)
app.get('/users/view/:id', isLogged, isManager, async (req, res) => {
    const userId = req.params.id;

    try {
        // Retrieve personal profile
        const participant = await knex('participantinfo')
            .where({ participantid: userId })
            .first();

        if (!participant) return res.status(404).send("User not found");

        // Retrieve registered future events
        const events = await knex('participantregistrations')
            .join('eventoccurrences', 'participantregistrations.eventoccurrenceid', 'eventoccurrences.eventoccurrenceid')
            .join('eventtemplates', 'eventoccurrences.eventtemplateid', 'eventtemplates.eventtemplateid')
            .select(
                'eventtemplates.eventname',
                'eventoccurrences.eventdatetimestart',
                'eventoccurrences.eventlocation',
                'participantregistrations.registrationstatus'
            )
            .where('participantregistrations.participantid', userId)
            .andWhere('eventoccurrences.eventdatetimestart', '>', knex.fn.now())
            .orderBy('eventoccurrences.eventdatetimestart', 'asc');

        // Retrieve milestones achieved by user
        const milestones = await knex('participantmilestones')
            .join('milestones', 'participantmilestones.milestoneid', 'milestones.milestoneid')
            .select(
                'participantmilestones.participantmilestoneid',
                'participantmilestones.milestonedate',
                'milestones.milestonetitle',
                'milestones.milestoneid'
            )
            .where('participantmilestones.participantid', userId)
            .orderBy('participantmilestones.milestonedate', 'desc');

        // Retrieve all possible milestones
        const allMilestones = await knex('milestones').select('*');

        res.render('participantDetail', {
            title: 'Participant Details',
            participant,
            myRegistrations: events,
            milestones,
            allMilestones,
            myDonations: []
        });

    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading user details.");
    }
});


// Remove a user from a specific event registration
app.post('/users/deregister/:registrationId', isLogged, isManager, async (req, res) => {
    const registrationId = req.params.registrationId;
    const participantId = req.body.participantId;

    try {
        await knex('participantregistrations')
            .where({ participantregistrationid: registrationId, participantid: participantId })
            .del();

        res.redirect('back');
    } catch (err) {
        console.error(err);
        res.redirect('back');
    }
});


// Display page for adding a new user
app.get('/users/add', isLogged, isManager, (req, res) => {
    res.render('addUser', { title: 'Add New User' });
});

// Handle creation of a new user
app.post('/users/add', isLogged, isManager, async (req, res) => {
    const { firstName, lastName, email, password, role } = req.body;
    try {
        const maxIdResult = await knex('participantinfo').max('participantid as maxId').first();
        const nextId = (maxIdResult.maxId || 0) + 1;

        await knex('participantinfo').insert({
            participantid: nextId,
            participantfirstname: firstName,
            participantlastname: lastName,
            participantemail: email,
            participantpassword: password,
            participantrole: role
        });

        res.redirect('/users');
    } catch (err) {
        console.error(err);
        res.status(500).send("Error adding user.");
    }
});


// Handle user deletion
app.post('/users/delete/:id', isLogged, isManager, async (req, res) => {
    try {
        await knex('participantinfo')
            .where({ participantid: req.params.id })
            .del();

        res.redirect('/users');
    } catch (err) {
        console.error(err);
        res.status(500).send("Error deleting user. Check for related records.");
    }
});


// ==========================================
// SURVEY ROUTES (Admin)
// ==========================================

// Display list of surveys with optional search
app.get('/surveys', isLogged, async (req, res) => {
    const search = req.query.search || '';

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
            .modify(qb => {
                if (search) {
                    qb.where('participantinfo.participantfirstname', 'ilike', `%${search}%`)
                      .orWhere('participantinfo.participantlastname', 'ilike', `%${search}%`)
                      .orWhere('eventtemplates.eventname', 'ilike', `%${search}%`);
                }
            })
            .orderBy('participantsurveys.surveysubmissiondate', 'desc');

        res.render('surveys', { title: 'Survey List', surveys, search });
    } catch (err) {
        console.error("Survey List Error:", err);
        res.status(500).send("Error loading surveys.");
    }
});


// Display details for a specific survey
app.get('/surveys/:id', isLogged, async (req, res) => {
    const surveyId = req.params.id;

    try {
        const header = await knex('participantsurveys')
            .join('participantinfo', 'participantsurveys.participantid', 'participantinfo.participantid')
            .join('eventoccurrences', 'participantsurveys.eventoccurrenceid', 'eventoccurrences.eventoccurrenceid')
            .join('eventtemplates', 'eventoccurrences.eventtemplateid', 'eventtemplates.eventtemplateid')
            .select(
                'participantinfo.participantfirstname',
                'participantinfo.participantlastname',
                'eventtemplates.eventname',
                'eventoccurrences.eventdatetimestart as eventdate'
            )
            .where('participantsurveys.participantsurveyid', surveyId)
            .first();

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


// Test survey page (for development; does not store data)
app.get('/testSurvey', isLogged, (req, res) => {
    const returnUrl = req.query.returnUrl || '/profile';
    res.render('testSurvey', { title: 'Test Survey', returnUrl });
});

app.post('/testSurvey', isLogged, (req, res) => {
    const returnUrl = req.body.returnUrl || '/profile';
    res.redirect(returnUrl);
});


// ==========================================
// USER-SIDE SURVEY ROUTES
// ==========================================

// Display survey list for logged-in user
app.get('/surveyUser', isLogged, async (req, res) => {
    const search = req.query.search || '';
    const userId = req.session.user.participantid;

    try {
        const surveys = await knex('participantsurveys')
            .join('eventoccurrences', 'participantsurveys.eventoccurrenceid', 'eventoccurrences.eventoccurrenceid')
            .join('eventtemplates', 'eventoccurrences.eventtemplateid', 'eventtemplates.eventtemplateid')
            .select(
                'participantsurveys.participantsurveyid',
                'participantsurveys.surveysubmissiondate',
                'eventtemplates.eventname',
                'eventoccurrences.eventdatetimestart as eventdate'
            )
            .where('participantsurveys.participantid', userId)
            .modify(qb => {
                if (search) qb.where('eventtemplates.eventname', 'ilike', `%${search}%`);
            })
            .orderBy('participantsurveys.surveysubmissiondate', 'desc');

        res.render('surveyUser', { title: 'My Surveys', surveys, search });
    } catch (err) {
        console.error("User Survey List Error:", err);
        res.status(500).send("Error loading your surveys.");
    }
});


// Display details for a user's own survey submission
app.get('/surveyUser/:id', isLogged, async (req, res) => {
    const surveyId = req.params.id;
    const userId = req.session.user.participantid;

    try {
        const header = await knex('participantsurveys')
            .join('eventoccurrences', 'participantsurveys.eventoccurrenceid', 'eventoccurrences.eventoccurrenceid')
            .join('eventtemplates', 'eventoccurrences.eventtemplateid', 'eventtemplates.eventtemplateid')
            .select(
                'eventtemplates.eventname',
                'eventoccurrences.eventdatetimestart as eventdate'
            )
            .where('participantsurveys.participantsurveyid', surveyId)
            .andWhere('participantsurveys.participantid', userId)
            .first();

        if (!header) return res.status(404).send("Survey not found.");

        const details = await knex('surveyresponses')
            .join('surveyquestions', 'surveyresponses.questionid', 'surveyquestions.questionid')
            .select('surveyquestions.question', 'surveyresponses.response')
            .where('surveyresponses.participantsurveyid', surveyId)
            .orderBy('surveyquestions.questionid');

        res.render('surveyUserDetail', { title: 'Survey Details', header, details });

    } catch (err) {
        console.error("User Survey Detail Error:", err);
        res.status(500).send("Error loading survey details.");
    }
});


// ==========================================
// DONATION CRUD ROUTES (Admin Only)
// ==========================================

// Display donation list with optional search
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
                if (search) {
                    const term = `%${search}%`;
                    builder.where('participantinfo.participantfirstname', 'ilike', term)
                           .orWhere('participantinfo.participantlastname', 'ilike', term)
                           .orWhereRaw("participantinfo.participantfirstname || ' ' || participantinfo.participantlastname ILIKE ?", [term]);
                }
            })
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
        res.status(500).send("Error loading donations.");
    }
});


// Display page for adding a donation
app.get('/admin/donations/add', isLogged, isManager, async (req, res) => {
    try {
        const participants = await knex('participantinfo')
            .select('participantid', 'participantfirstname', 'participantlastname', 'participantemail')
            .orderBy('participantfirstname');

        res.render('addDonation', { title: 'Add Donation', participants });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading add page.");
    }
});


// Handle donation creation
app.post('/admin/donations/add', isLogged, isManager, async (req, res) => {
    const { participantId, amount, date } = req.body;
    try {
        const maxIdResult = await knex('participantdonations').max('participantdonationid as maxId').first();
        const nextId = (maxIdResult.maxId || 0) + 1;

        await knex('participantdonations').insert({
            participantdonationid: nextId,
            participantid: participantId,
            donationamount: amount,
            donationdate: date,
            donationno: 1
        });

        res.redirect('/admin/donations');
    } catch (err) {
        console.error(err);
        res.status(500).send("Error adding donation.");
    }
});


// Display donation edit page
app.get('/admin/donations/edit/:id', isLogged, isManager, async (req, res) => {
    try {
        const donation = await knex('participantdonations')
            .join('participantinfo', 'participantdonations.participantid', 'participantinfo.participantid')
            .select('participantdonations.*', 'participantinfo.participantfirstname', 'participantinfo.participantlastname')
            .where({ participantdonationid: req.params.id })
            .first();

        if (donation) {
            res.render('editDonation', { title: 'Edit Donation', donation });
        } else {
            res.redirect('/admin/donations');
        }
    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading donation.");
    }
});


// Handle donation update
app.post('/admin/donations/edit/:id', isLogged, isManager, async (req, res) => {
    const { amount, date } = req.body;
    try {
        await knex('participantdonations')
            .where({ participantdonationid: req.params.id })
            .update({
                donationamount: amount,
                donationdate: date
            });

        res.redirect('/admin/donations');
    } catch (err) {
        console.error(err);
        res.status(500).send("Error updating donation.");
    }
});


// Handle donation deletion
app.post('/admin/donations/delete/:id', isLogged, isManager, async (req, res) => {
    try {
        await knex('participantdonations')
            .where({ participantdonationid: req.params.id })
            .del();

        res.redirect('/admin/donations');
    } catch (err) {
        console.error(err);
        res.status(500).send("Error deleting donation.");
    }
});


// ==========================================
// DASHBOARD ROUTE
// ==========================================

// Display Tableau dashboard page
app.get('/dashboard', isLogged, isManager, async (req, res) => {
    res.render('dashboard', {
        title: 'Dashboard',
        error: null
    });
});

// ==========================================
// Public Donation Routes (Accessible to Visitors)
// ==========================================


// Display the donation page (no login required)
app.get('/donate', (req, res) => {
    // If the user is logged in, pre-fill form fields with user data
    res.render('donations', { 
        title: 'Donate to Ella Rises',
        user: req.session.user || null 
    });
});


// Process a donation submission
app.post('/donate', async (req, res) => {
    const { email, amount, firstName, lastName } = req.body;

    try {
        // Step 1: Check if the donor already exists (search by email)
        let participant = await knex('participantinfo')
            .where({ participantemail: email })
            .first();

        let participantId;

        // Step 2: If not a participant, create a new participant record
        if (!participant) {
            const maxIdResult = await knex('participantinfo')
                .max('participantid as maxId')
                .first();

            const nextId = (maxIdResult.maxId || 0) + 1;
            participantId = nextId;

            await knex('participantinfo').insert({
                participantid: participantId,
                participantemail: email,
                participantfirstname: firstName,
                participantlastname: lastName,
                participantrole: 'donor' 
                // No password is created; user must register later if they want to log in.
            });

        } else {
            participantId = participant.participantid;
        }

        // Step 3: Record the donation in ParticipantDonations table
        const maxDonationId = await knex('participantdonations')
            .max('participantdonationid as maxId')
            .first();

        const nextDonationId = (maxDonationId.maxId || 0) + 1;

        await knex('participantdonations').insert({
            participantdonationid: nextDonationId,
            participantid: participantId,
            donationamount: amount,
            donationdate: new Date(),
            donationno: 1 // Donation count (additional logic can be added if needed)
        });

        // Step 4: Redirect to a thank-you message or homepage
        res.send("<script>alert('Thank you for your generous donation!'); window.location.href='/';</script>");

    } catch (err) {
        console.error("Donation Error:", err);
        res.status(500).send("Error processing donation: " + err.message);
    }
});


// 418 Teapot page (fun Easter egg route)
app.get('/teapot', (req, res) => {
    res.status(418).render('teapot', { title: '418' });
});


// Start the server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
